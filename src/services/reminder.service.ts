import { JsonStore } from '../store/json-store.js';
import { TelegramBotService } from '../bot/telegram.js';
import { BankProvider } from '../providers/bank-provider.js';
import { SepayProvider } from '../providers/sepay.provider.js';
import { config } from '../config.js';
import { Service, Group, Member, ExpenseBatch, ExpenseBatchMemberItem } from '../types.js';

export class ReminderService {
  private static instance: ReminderService;
  private store: JsonStore;
  private telegram: TelegramBotService;
  private bankProvider: BankProvider;

  private constructor() {
    this.store = JsonStore.getInstance();
    this.telegram = TelegramBotService.getInstance();
    this.bankProvider = new SepayProvider();
  }

  public static getInstance(): ReminderService {
    if (!ReminderService.instance) {
      ReminderService.instance = new ReminderService();
    }
    return ReminderService.instance;
  }

  /**
   * Lấy ngày, tháng, giờ phút hiện tại theo múi giờ cấu hình (Asia/Ho_Chi_Minh)
   */
  public getZonedTimeParts(date = new Date()): { day: number; timeStr: string; monthKey: string; displayMonth: string } {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: config.TZ || 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';

    const y = getPart('year');
    const m = getPart('month');
    const d = parseInt(getPart('day'), 10);
    const rawH = getPart('hour');
    const h = rawH === '24' ? '00' : rawH.padStart(2, '0');
    const min = getPart('minute').padStart(2, '0');

    return {
      day: d,
      timeStr: `${h}:${min}`,
      monthKey: `${y}-${m}`,
      displayMonth: `${m}/${y}`
    };
  }

  /**
   * Render nội dung tin nhắn nhắc nợ từ template và biến thay thế (Cho gói định kỳ)
   */
  public renderMessageTemplate(service: Service, group: Group, members: Member[], monthStr: string): { message: string; qrUrl: string } {
    const totalAmountStr = service.totalAmount.toLocaleString('vi-VN');
    
    // Tạo danh sách thành viên và số tiền cần đóng (cú pháp ngắn gọn, dễ nhớ)
    let memberListStr = '';
    const activeMembers = members.filter(m => m.active);
    
    if (activeMembers.length === 0) {
      memberListStr = '_(Chưa có danh sách thành viên)_';
    } else {
      memberListStr = activeMembers
        .map((m, idx) => {
          const amount = service.mode === 'per_member' && m.customAmount
            ? m.customAmount
            : (service.defaultAmountPerMember || Math.round(service.totalAmount / activeMembers.length));
          const tag = m.telegramUsername ? `@${m.telegramUsername}` : m.name;
          const fullCode = this.getPrefixedTransferCode(service, m.transferCode);
          return `• ${tag}: *${amount.toLocaleString('vi-VN')}đ* ➔ ND: \`${fullCode}\``;
        })
        .join('\n');
    }

    // Tạo mã QR VietQR mẫu cho dịch vụ (cú pháp ngắn gọn: transferPrefix)
    // Không khóa cứng số tiền để 100% App ngân hàng cho phép người quét tự do nhập tiền & sửa nội dung
    const qrDescription = service.transferPrefix || '';
    
    const qrUrl = this.bankProvider.generateQRUrl({
      bankInfo: service.bankInfo,
      description: qrDescription,
      template: 'compact2'
    });

    let rendered = service.messageTemplate;
    const replacements: Record<string, string> = {
      '{groupName}': group.title,
      '{serviceName}': service.name,
      '{totalAmount}': totalAmountStr,
      '{month}': monthStr,
      '{memberList}': memberListStr,
      '{bankName}': service.bankInfo.bankCode,
      '{bankCode}': service.bankInfo.bankCode,
      '{accountNumber}': service.bankInfo.accountNumber,
      '{accountName}': service.bankInfo.accountName,
      '{transferPrefix}': service.transferPrefix || '',
      '{qrUrl}': qrUrl
    };

    for (const [key, value] of Object.entries(replacements)) {
      rendered = rendered.split(key).join(value);
    }

    return {
      message: rendered,
      qrUrl
    };
  }

  /**
   * Đảm bảo mã chuyển khoản luôn có tiền tố dịch vụ (Service Prefix)
   */
  public getPrefixedTransferCode(service: Service, transferCode: string): string {
    const cleanCode = (transferCode || '').trim();
    const prefix = (service.transferPrefix || '').trim();
    if (prefix && !cleanCode.toUpperCase().startsWith(prefix.toUpperCase())) {
      return `${prefix} ${cleanCode}`;
    }
    return cleanCode;
  }

  /**
   * Kiểm tra các dịch vụ đến ngày & giờ nhắc và gửi thông báo tự động (Chỉ cho dịch vụ monthly)
   */
  public async checkAndSendReminders(targetDate = new Date(), forceCheck = false): Promise<{ checkedCount: number; sentCount: number }> {
    const state = await this.store.read();
    const { day, timeStr, monthKey, displayMonth } = this.getZonedTimeParts(targetDate);

    let sentCount = 0;
    let checkedCount = 0;

    for (const service of state.services) {
      if (!service.active) continue;

      // Bỏ qua các dịch vụ thu theo đợt / không định kỳ
      if (service.scheduleType === 'on_demand') {
        continue;
      }

      checkedCount++;

      // Kiểm tra ngày nhắc
      if (service.reminderDay !== day) {
        continue;
      }

      // Nếu chạy tự động theo lịch (không phải bấm nút thủ công), kiểm tra đúng giờ:phút hẹn
      if (!forceCheck) {
        const serviceTime = service.reminderTime || '08:00';
        if (serviceTime !== timeStr) {
          continue;
        }
      }

      // Khóa chống gửi trùng lặp: `groupId:serviceId:YYYY-MM`
      const receiptKey = `${service.groupId}:${service.id}:${monthKey}`;
      const alreadySent = state.reminderReceipts.some(r => r.key === receiptKey && r.status === 'success');

      if (alreadySent) {
        console.log(`ℹ️ Đã gửi thông báo cho dịch vụ ${service.name} trong tháng ${monthKey}, bỏ qua.`);
        continue;
      }

      const group = state.groups.find(g => g.id === service.groupId && g.active);
      if (!group) {
        console.warn(`⚠️ Không tìm thấy nhóm Telegram hợp lệ cho dịch vụ ${service.name} (groupId: ${service.groupId})`);
        continue;
      }

      const members = state.members[service.id] || [];
      const { message, qrUrl } = this.renderMessageTemplate(service, group, members, displayMonth);

      console.log(`🚀 [${timeStr}] Bắt đầu gửi nhắc nợ dịch vụ "${service.name}" tới nhóm "${group.title}" (${group.chatId})...`);

      // Tạo đợt thu theo tháng tương ứng
      const activeMembers = members.filter(m => m.active);
      const batchMembers: ExpenseBatchMemberItem[] = activeMembers.map(m => {
        const expected = service.mode === 'per_member' && m.customAmount
          ? m.customAmount
          : (service.defaultAmountPerMember || Math.round(service.totalAmount / (activeMembers.length || 1)));
        return {
          memberId: m.id,
          name: m.name,
          transferCode: m.transferCode,
          telegramUsername: m.telegramUsername,
          amount: expected,
          paidAmount: 0,
          status: 'unpaid'
        };
      });

      const monthlyBatch: ExpenseBatch = {
        id: `batch_monthly_${service.id}_${monthKey}`,
        serviceId: service.id,
        groupId: group.id,
        title: `${service.name} (Tháng ${displayMonth})`,
        batchType: 'monthly',
        month: monthKey,
        totalAmount: service.totalAmount,
        members: batchMembers,
        sentAt: new Date().toISOString(),
        status: 'active'
      };

      // Tạo danh sách nút bấm cho từng thành viên
      const buttons = batchMembers.map(m => ({
        text: `💳 ${m.name} (${m.amount.toLocaleString('vi-VN')}đ)`,
        callbackData: `pay_batch:${monthlyBatch.id}:${m.memberId}`
      }));

      const groupMsg = `${message}\n\n👇 *BẤM VÀO TÊN BẠN DƯỚI ĐÂY ĐỂ LẤY MÃ VIETQR RIÊNG (TỰ ĐỘNG XÓA SAU KHI CK):*`;
      const result = await this.telegram.sendMessageWithButtons(group.chatId, groupMsg, buttons, group.threadId);
      monthlyBatch.messageId = result.messageId;

      // Lưu receipt và cập nhật batch
      await this.store.update(s => {
        s.reminderReceipts.push({
          key: receiptKey,
          groupId: service.groupId,
          serviceId: service.id,
          month: monthKey,
          sentAt: new Date().toISOString(),
          messageId: result.messageId,
          status: result.success ? 'success' : 'failed',
          error: result.error
        });

        if (!s.expenseBatches) s.expenseBatches = [];
        const existingIdx = s.expenseBatches.findIndex(b => b.id === monthlyBatch.id);
        if (existingIdx >= 0) {
          s.expenseBatches[existingIdx] = monthlyBatch;
        } else {
          s.expenseBatches.unshift(monthlyBatch);
        }
      });

      if (result.success) {
        sentCount++;
        console.log(`✅ Đã gửi thành công nhắc nợ dịch vụ ${service.name}`);
      } else {
        console.error(`❌ Gửi nhắc nợ dịch vụ ${service.name} thất bại: ${result.error}`);
      }
    }

    return { checkedCount, sentCount };
  }

  /**
   * Tạo và gửi đợt thu tiền phát sinh (Gửi tin nhắn thông báo kèm nút bấm tên thành viên & DM riêng)
   */
  public async sendCustomBatchReminder(
    serviceId: string,
    title: string,
    memberAmounts: { memberId: string; amount: number }[],
    note?: string
  ): Promise<{ success: boolean; batch: ExpenseBatch; messageId?: number; error?: string; qrUrl: string }> {
    const state = await this.store.read();
    const service = state.services.find(s => s.id === serviceId);
    if (!service) throw new Error('Dịch vụ không tồn tại');

    const group = state.groups.find(g => g.id === service.groupId);
    if (!group) throw new Error('Nhóm Telegram không tồn tại');

    const allMembers = state.members[serviceId] || [];
    let totalBatchAmount = 0;
    const batchMembers: ExpenseBatchMemberItem[] = [];

    for (const item of memberAmounts) {
      const mem = allMembers.find(m => m.id === item.memberId);
      if (mem && item.amount > 0) {
        totalBatchAmount += item.amount;
        batchMembers.push({
          memberId: mem.id,
          name: mem.name,
          transferCode: mem.transferCode,
          telegramUsername: mem.telegramUsername,
          amount: item.amount,
          paidAmount: 0,
          status: 'unpaid'
        });
      }
    }

    if (batchMembers.length === 0) {
      throw new Error('Vui lòng nhập số tiền lớn hơn 0 cho ít nhất một thành viên');
    }

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const newBatch: ExpenseBatch = {
      id: `batch_${Date.now()}`,
      serviceId,
      groupId: group.id,
      title,
      batchType: 'on_demand',
      month: currentMonthKey,
      totalAmount: totalBatchAmount,
      members: batchMembers,
      sentAt: new Date().toISOString(),
      status: 'active',
      note
    };

    // Tạo các nút bấm tương ứng với từng thành viên
    const buttons = batchMembers.map(m => ({
      text: `💳 ${m.name} (${m.amount.toLocaleString('vi-VN')}đ)`,
      callbackData: `pay_batch:${newBatch.id}:${m.memberId}`
    }));

    // Tạo nội dung tin nhắn đợt thu ngắn gọn, trực quan
    let msg = `📢 *[THU TIỀN: ${title.toUpperCase()}]*\n`;
    if (note) msg += `📝 Ghi chú: _${note}_\n`;
    msg += `💰 Tổng cộng: *${totalBatchAmount.toLocaleString('vi-VN')}đ*\n\n`;
    msg += `📋 *Danh sách cần đóng (${batchMembers.length} người):*\n`;

    batchMembers.forEach((m) => {
      const tag = m.telegramUsername ? `@${m.telegramUsername}` : m.name;
      const fullCode = this.getPrefixedTransferCode(service, m.transferCode);
      msg += `• ${tag}: *${m.amount.toLocaleString('vi-VN')}đ* ➔ ND: \`${fullCode}\`\n`;
    });

    msg += `\n💳 *Tài khoản nhận tiền:*\n`;
    msg += `• Ngân hàng: *${service.bankInfo.bankCode}*\n`;
    msg += `• STK: \`${service.bankInfo.accountNumber}\`\n`;
    msg += `• Chủ TK: *${service.bankInfo.accountName}*\n\n`;
    msg += `👇 *BẤM VÀO TÊN BẠN DƯỚI ĐÂY ĐỂ LẤY MÃ VIETQR RIÊNG (TỰ ĐỘNG XÓA SAU KHI CK):*`;

    // Gửi tin nhắn thông báo kèm nút bấm thành viên vào nhóm
    const sendResult = await this.telegram.sendMessageWithButtons(group.chatId, msg, buttons, group.threadId);
    newBatch.messageId = sendResult.messageId;

    // Cập nhật State
    await this.store.update(s => {
      if (!s.expenseBatches) s.expenseBatches = [];
      s.expenseBatches.unshift(newBatch);

      // Cập nhật MonthlyMemberPayment tương ứng
      for (const bm of batchMembers) {
        let payment = s.monthlyPayments.find(
          p => p.serviceId === serviceId && p.memberId === bm.memberId && p.month === currentMonthKey
        );

        if (!payment) {
          s.monthlyPayments.push({
            memberId: bm.memberId,
            serviceId: serviceId,
            month: currentMonthKey,
            expectedAmount: bm.amount,
            paidAmount: 0,
            status: 'unpaid',
            transactionIds: []
          });
        } else {
          payment.expectedAmount = bm.amount;
        }
      }
    });

    const sampleQr = this.bankProvider.generateQRUrl({
      bankInfo: service.bankInfo,
      description: service.transferPrefix || '',
      template: 'compact2'
    });

    return {
      success: sendResult.success,
      batch: newBatch,
      messageId: sendResult.messageId,
      error: sendResult.error,
      qrUrl: sampleQr
    };
  }

  /**
   * Quét và gửi nhắc nợ trực tiếp cho từng thành viên chưa đóng tiền
   */
  public async scanAndSendIndividualReminders(): Promise<{
    scannedServices: number;
    unpaidCount: number;
    directDMSent: number;
    groupRemindersSent: number;
  }> {
    const state = await this.store.read();
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const displayMonth = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    let scannedServices = 0;
    let unpaidCount = 0;
    let directDMSent = 0;
    let groupRemindersSent = 0;

    for (const service of state.services) {
      if (!service.active) continue;
      scannedServices++;

      const group = state.groups.find(g => g.id === service.groupId && g.active);
      if (!group) continue;

      const members = state.members[service.id] || [];
      const activeMembers = members.filter(m => m.active);

      // Tìm danh sách thành viên chưa đóng
      const unpaidMembers: { member: Member; amount: number; batchId?: string }[] = [];

      // Kiểm tra trong các đợt thu active của dịch vụ này
      const serviceBatches = (state.expenseBatches || []).filter(
        b => b.serviceId === service.id && b.status === 'active'
      );

      if (serviceBatches.length > 0) {
        for (const b of serviceBatches) {
          for (const bm of b.members) {
            if (bm.status !== 'paid') {
              const originalMember = activeMembers.find(m => m.id === bm.memberId);
              if (originalMember) {
                unpaidMembers.push({ member: originalMember, amount: bm.amount, batchId: b.id });
              }
            }
          }
        }
      } else {
        // Kiểm tra trong monthly payments
        for (const m of activeMembers) {
          const payment = state.monthlyPayments.find(
            p => p.serviceId === service.id && p.memberId === m.id && p.month === currentMonthKey
          );
          if (!payment || payment.status !== 'paid') {
            const expected = service.mode === 'per_member' && m.customAmount
              ? m.customAmount
              : (service.defaultAmountPerMember || Math.round(service.totalAmount / (activeMembers.length || 1)));
            unpaidMembers.push({ member: m, amount: expected });
          }
        }
      }

      unpaidCount += unpaidMembers.length;

      if (unpaidMembers.length === 0) continue;

      // Gửi thông báo tổng hợp vào nhóm với các nút bấm tên người chưa đóng
      const buttons = unpaidMembers.map(item => ({
        text: `💳 ${item.member.name} (${item.amount.toLocaleString('vi-VN')}đ)`,
        callbackData: item.batchId ? `pay_batch:${item.batchId}:${item.member.id}` : `pay_svc:${service.id}:${item.member.id}`
      }));

      let groupMsg =
        `⏰ *[NHẮC ĐÓNG TIỀN: ${service.name.toUpperCase()}]*\n\n` +
        `Hiện tại còn *${unpaidMembers.length} thành viên* chưa hoàn tất đóng tiền:\n`;

      unpaidMembers.forEach(item => {
        const tag = item.member.telegramUsername ? `@${item.member.telegramUsername}` : item.member.name;
        const fullCode = this.getPrefixedTransferCode(service, item.member.transferCode);
        groupMsg += `• ${tag}: *${item.amount.toLocaleString('vi-VN')}đ* ➔ ND: \`${fullCode}\`\n`;
      });

      groupMsg += `\n👇 *BẤM VÀO TÊN BẠN ĐỂ LẤY MÃ VIETQR RIÊNG (TỰ ĐỘNG XÓA SAU KHI CK):*`;

      const groupRes = await this.telegram.sendMessageWithButtons(group.chatId, groupMsg, buttons, group.threadId);
      if (groupRes.success) groupRemindersSent++;
    }

    return { scannedServices, unpaidCount, directDMSent, groupRemindersSent };
  }

  /**
   * Gửi thử nghiệm một tin nhắn nhắc nợ vào nhóm ngay từ Dashboard (Live Test)
   */
  public async sendTestReminder(serviceId: string): Promise<{ success: boolean; messageId?: number; error?: string; preview: string; qrUrl: string }> {
    const state = await this.store.read();
    const service = state.services.find(s => s.id === serviceId);
    if (!service) {
      throw new Error('Dịch vụ không tồn tại');
    }

    const group = state.groups.find(g => g.id === service.groupId);
    if (!group) {
      throw new Error('Nhóm Telegram không tồn tại');
    }

    const members = state.members[service.id] || [];
    const now = new Date();
    const displayMonth = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    const { message, qrUrl } = this.renderMessageTemplate(service, group, members, displayMonth);

    const testMessagePrefix = `🧪 *[TEST MESSAGE TỪ DASHBOARD]*\n\n`;
    const fullMessage = `${testMessagePrefix}${message}`;

    const activeMembers = members.filter(m => m.active);
    const buttons = activeMembers.map(m => {
      const expected = service.mode === 'per_member' && m.customAmount
        ? m.customAmount
        : (service.defaultAmountPerMember || Math.round(service.totalAmount / (activeMembers.length || 1)));
      return {
        text: `💳 ${m.name} (${expected.toLocaleString('vi-VN')}đ)`,
        callbackData: `pay_svc:${service.id}:${m.id}`
      };
    });

    const fullMessageWithButtons = `${fullMessage}\n\n👇 *BẤM VÀO TÊN BẠN DƯỚI ĐÂY ĐỂ LẤY MÃ VIETQR RIÊNG (TỰ ĐỘNG XÓA SAU KHI CK):*`;
    const result = await this.telegram.sendMessageWithButtons(group.chatId, fullMessageWithButtons, buttons, group.threadId);

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      preview: fullMessageWithButtons,
      qrUrl
    };
  }

  /**
   * Tự động dọn dẹp các đợt thu tiền đã hoàn tất (100% đã đóng) quá 7 ngày để giải phóng bộ nhớ RAM và file JSON
   */
  public async cleanupCompletedBatches(retentionDays = 7): Promise<{ cleanedCount: number; deletedBatchTitles: string[] }> {
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const deletedBatchTitles: string[] = [];

    await this.store.update(state => {
      if (!state.expenseBatches || state.expenseBatches.length === 0) return;

      const remainingBatches: ExpenseBatch[] = [];

      for (const batch of state.expenseBatches) {
        const isAllPaid = batch.members && batch.members.length > 0 && batch.members.every(m => m.status === 'paid');
        const isCompleted = batch.status === 'completed' || isAllPaid;

        const timeString = batch.completedAt || batch.sentAt;
        const timeVal = timeString ? new Date(timeString).getTime() : 0;

        // Nếu đã hoàn tất và quá 7 ngày -> Xóa
        if (isCompleted && timeVal > 0 && timeVal < cutoffTime) {
          deletedBatchTitles.push(batch.title || batch.id);
        } else {
          remainingBatches.push(batch);
        }
      }

      if (deletedBatchTitles.length > 0) {
        state.expenseBatches = remainingBatches;
      }
    });

    if (deletedBatchTitles.length > 0) {
      console.log(`🧹 [AUTO CLEANUP] Đã tự động dọn dẹp ${deletedBatchTitles.length} đợt thu tiền đã hoàn tất quá ${retentionDays} ngày:`, deletedBatchTitles);
    }

    return {
      cleanedCount: deletedBatchTitles.length,
      deletedBatchTitles
    };
  }
}

