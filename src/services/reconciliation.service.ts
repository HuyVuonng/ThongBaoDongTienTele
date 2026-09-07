import { JsonStore } from '../store/json-store.js';
import { TelegramBotService } from '../bot/telegram.js';
import { Transaction, Service, Group, Member, MonthlyMemberPayment } from '../types.js';

export interface MatchResult {
  matched: boolean;
  service?: Service;
  group?: Group;
  member?: Member;
  targetMonth?: string;
  isDuplicate?: boolean;
}

export class ReconciliationService {
  private static instance: ReconciliationService;
  private store: JsonStore;
  private telegram: TelegramBotService;

  private constructor() {
    this.store = JsonStore.getInstance();
    this.telegram = TelegramBotService.getInstance();
  }

  public static getInstance(): ReconciliationService {
    if (!ReconciliationService.instance) {
      ReconciliationService.instance = new ReconciliationService();
    }
    return ReconciliationService.instance;
  }

  /**
   * Chuẩn hóa chuỗi nội dung chuyển khoản để so khớp linh hoạt
   */
  public normalizeContent(text: string): string {
    return text
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Bỏ dấu tiếng Việt
      .replace(/[^A-Z0-9]/g, ' ')      // Đổi ký tự đặc biệt thành dấu cách
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Trích xuất tháng từ nội dung chuyển khoản (VD: "NET-AN 09/2026", "NET AN T9", "THANG 9")
   */
  public extractMonth(content: string, defaultDate = new Date()): string {
    const normalized = this.normalizeContent(content);
    
    // Tìm dạng YYYY-MM hoặc MM/YYYY (VD: 09 2026, 092026)
    const monthYearMatch = normalized.match(/(0[1-9]|1[0-2])\s*(20\d{2})/);
    if (monthYearMatch) {
      const m = monthYearMatch[1];
      const y = monthYearMatch[2];
      return `${y}-${m}`;
    }

    // Tìm dạng T09, THANG 9, T9
    const thangMatch = normalized.match(/(?:THANG|T)\s*([1-9]|0[1-9]|1[0-2])\b/);
    if (thangMatch) {
      const m = String(thangMatch[1]).padStart(2, '0');
      const y = defaultDate.getFullYear();
      return `${y}-${m}`;
    }

    // Mặc định tháng hiện tại
    return `${defaultDate.getFullYear()}-${String(defaultDate.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Tìm kiếm thành viên và dịch vụ khớp với nội dung giao dịch
   */
  public findMatch(content: string, stateServices: Service[], stateMembers: Record<string, Member[]>, stateGroups: Group[]): MatchResult {
    const normalized = this.normalizeContent(content); // Thay ký tự đặc biệt thành dấu cách: "TEST A HUY"
    const compactContent = normalized.replace(/\s+/g, ''); // "TESTAHUY"

    // PASS 1: Ưu tiên khớp chính xác CẢ TIỀN TỐ (PREFIX) + MÃ THÀNH VIÊN (combined)
    for (const service of stateServices) {
      if (!service.active) continue;
      const members = stateMembers[service.id] || [];
      const prefixNorm = this.normalizeContent(service.transferPrefix || '');
      const prefixCompact = prefixNorm.replace(/\s+/g, '');

      if (prefixCompact.length > 0) {
        for (const member of members) {
          if (!member.active) continue;

          const codeNorm = this.normalizeContent(member.transferCode);
          const codeCompact = codeNorm.replace(/\s+/g, '');

          const combinedNorm = `${prefixNorm} ${codeNorm}`.trim();
          const combinedCompact = `${prefixCompact}${codeCompact}`.trim();

          const isCombinedMatched =
            (combinedNorm.length > 0 && normalized.includes(combinedNorm)) ||
            (combinedCompact.length > 0 && compactContent.includes(combinedCompact));

          if (isCombinedMatched) {
            const group = stateGroups.find(g => g.id === service.groupId);
            const targetMonth = this.extractMonth(content);
            return {
              matched: true,
              service,
              group,
              member,
              targetMonth
            };
          }
        }
      }
    }

    // PASS 2: Nếu không có tiền tố trong ND, khớp theo mã thành viên riêng (codeNorm / codeCompact)
    for (const service of stateServices) {
      if (!service.active) continue;
      const members = stateMembers[service.id] || [];

      for (const member of members) {
        if (!member.active) continue;

        const codeNorm = this.normalizeContent(member.transferCode);
        const codeCompact = codeNorm.replace(/\s+/g, '');

        if (codeCompact.length < 2) continue; // Tránh khớp nhầm mã 1 ký tự

        const isCodeMatched =
          (codeNorm.length > 0 && normalized.includes(codeNorm)) ||
          (codeCompact.length > 0 && compactContent.includes(codeCompact));

        if (isCodeMatched) {
          const group = stateGroups.find(g => g.id === service.groupId);
          const targetMonth = this.extractMonth(content);
          return {
            matched: true,
            service,
            group,
            member,
            targetMonth
          };
        }
      }
    }

    return { matched: false };
  }

  /**
   * Xử lý giao dịch nhận được từ Webhook
   */
  public async processTransaction(incomingTx: {
    id: string;
    gateway: string;
    transactionDate: string;
    accountNumber: string;
    amount: number;
    content: string;
    code?: string;
    referenceCode?: string;
    rawPayload: any;
  }): Promise<{ matched: boolean; isDuplicate: boolean; transaction: Transaction }> {
    const state = await this.store.read();

    // 1. Chống xử lý trùng lặp giao dịch (Deduplication)
    const existingTx = state.transactions.find(t => t.id === incomingTx.id);
    if (existingTx) {
      console.log(`ℹ️ Giao dịch đã tồn tại trong hệ thống (ID: ${incomingTx.id}), bỏ qua.`);
      return { matched: existingTx.matched, isDuplicate: true, transaction: existingTx };
    }

    // 2. Đối soát tìm dịch vụ & thành viên
    const match = this.findMatch(incomingTx.content, state.services, state.members, state.groups);

    const transaction: Transaction = {
      id: incomingTx.id,
      gateway: incomingTx.gateway,
      transactionDate: incomingTx.transactionDate,
      accountNumber: incomingTx.accountNumber,
      amount: incomingTx.amount,
      content: incomingTx.content,
      code: incomingTx.code,
      referenceCode: incomingTx.referenceCode,
      matched: match.matched,
      groupId: match.group?.id,
      serviceId: match.service?.id,
      memberId: match.member?.id,
      month: match.targetMonth,
      rawPayload: incomingTx.rawPayload,
      createdAt: new Date().toISOString()
    };

    // 3. Cập nhật State
    let celebrationPayload: { group: Group; batchTitle: string; totalAmount: number; count: number } | null = null;
    const qrMessagesToDelete: { chatId: string; messageId: number }[] = [];

    await this.store.update(s => {
      s.transactions.unshift(transaction);

      // Giới hạn lịch sử giao dịch (1000 items)
      if (s.transactions.length > 1000) {
        s.transactions = s.transactions.slice(0, 1000);
      }

      if (match.matched && match.service && match.member && match.targetMonth) {
        // Cập nhật MonthlyMemberPayment
        const expected = match.service.mode === 'per_member' && match.member.customAmount
          ? match.member.customAmount
          : (match.service.defaultAmountPerMember || Math.round(match.service.totalAmount / (s.members[match.service.id]?.length || 1)));

        let payment = s.monthlyPayments.find(
          p => p.serviceId === match.service!.id && p.memberId === match.member!.id && p.month === match.targetMonth
        );

        if (!payment) {
          payment = {
            memberId: match.member.id,
            serviceId: match.service.id,
            month: match.targetMonth,
            expectedAmount: expected,
            paidAmount: incomingTx.amount,
            status: incomingTx.amount >= expected ? 'paid' : 'partial',
            transactionIds: [transaction.id],
            paidAt: new Date().toISOString()
          };
          s.monthlyPayments.push(payment);
        } else {
          payment.paidAmount += incomingTx.amount;
          payment.status = payment.paidAmount >= payment.expectedAmount ? 'paid' : 'partial';
          if (!payment.transactionIds.includes(transaction.id)) {
            payment.transactionIds.push(transaction.id);
          }
          payment.paidAt = new Date().toISOString();

          // Xóa tin nhắn QR của payment này nếu có
          if (payment.qrMessageId && payment.qrChatId) {
            qrMessagesToDelete.push({ chatId: payment.qrChatId, messageId: payment.qrMessageId });
            payment.qrMessageId = undefined;
          }
        }

        // Cập nhật ExpenseBatch (cho cả dịch vụ định kỳ và không định kỳ)
        if (!s.expenseBatches) s.expenseBatches = [];

        // Tìm đợt thu phù hợp cho dịch vụ này
        let targetBatch = s.expenseBatches.find(b => 
          b.serviceId === match.service!.id && 
          b.status === 'active' && 
          b.members.some(m => m.memberId === match.member!.id && m.status !== 'paid')
        );

        // Nếu không có batch active có unpaid member, tìm batch theo tháng hoặc mới nhất
        if (!targetBatch) {
          targetBatch = s.expenseBatches.find(b => 
            b.serviceId === match.service!.id && 
            (b.month === match.targetMonth || b.id.includes(match.targetMonth!))
          );
        }

        if (targetBatch) {
          const batchMember = targetBatch.members.find(m => m.memberId === match.member!.id);
          if (batchMember) {
            batchMember.paidAmount = (batchMember.paidAmount || 0) + incomingTx.amount;
            batchMember.status = 'paid';
            batchMember.paidAt = new Date().toISOString();
            batchMember.transactionId = transaction.id;

            // Xóa tin nhắn QR của thành viên này trong nhóm
            if (batchMember.qrMessageId && batchMember.qrChatId) {
              qrMessagesToDelete.push({ chatId: batchMember.qrChatId, messageId: batchMember.qrMessageId });
              batchMember.qrMessageId = undefined;
            }
          }

          // Kiểm tra xem tất cả thành viên trong đợt đã đóng đủ chưa
          const isAllPaid = targetBatch.members.length > 0 && targetBatch.members.every(m => m.status === 'paid');
          if (isAllPaid && !targetBatch.completedNotificationSent) {
            targetBatch.status = 'completed';
            targetBatch.completedAt = new Date().toISOString();
            targetBatch.completedNotificationSent = true;

            if (match.group) {
              celebrationPayload = {
                group: match.group,
                batchTitle: targetBatch.title,
                totalAmount: targetBatch.totalAmount,
                count: targetBatch.members.length
              };
            }
          }
        }
      }
    });

    // Thực hiện xóa tin nhắn QR riêng sau khi thanh toán thành công
    for (const item of qrMessagesToDelete) {
      this.telegram.deleteMessage(item.chatId, item.messageId).catch(() => {});
    }

    // 4. Gửi thông báo Telegram
    if (match.matched && match.group && match.service && match.member) {
      const tag = this.telegram.formatTag(match.member.telegramUsername, match.member.name);
      const safeSvcName = (match.service.name || '').replace(/[*_`\\]/g, '');
      const displayMonth = match.targetMonth ? `${match.targetMonth.split('-')[1]}/${match.targetMonth.split('-')[0]}` : '';

      const notifyMsg = 
        `✅ *XÁC NHẬN THANH TOÁN THÀNH CÔNG*\n\n` +
        `👤 Thành viên: ${tag}\n` +
        `📦 Dịch vụ: *${safeSvcName}*\n` +
        `💰 Số tiền nhận: *${incomingTx.amount.toLocaleString('vi-VN')}đ*\n` +
        `🗓️ Kỳ: *Tháng ${displayMonth}*\n\n` +
        `🎉 _Hệ thống đã tự động ghi nhận! Cảm ơn bạn!_`;

      await this.telegram.sendPaymentSuccessNotification(match.group.chatId, notifyMsg, match.group.threadId);
      console.log(`✅ Đã đối soát thành công giao dịch ${transaction.id} cho thành viên ${match.member.name}`);

      // Nếu đợt thu này đã hoàn tất 100%, gửi thêm tin nhắn chúc mừng/thông báo thu đủ
      if (celebrationPayload) {
        const p = celebrationPayload as { group: Group; batchTitle: string; totalAmount: number; count: number };
        const celebrationMsg = 
          `🎉 *TẤT CẢ THÀNH VIÊN ĐÃ HOÀN TẤT ĐÓNG TIỀN!* 🎉\n\n` +
          `📦 Đợt thu: *${p.batchTitle}*\n` +
          `👥 Tiến độ: *${p.count}/${p.count} thành viên đã đóng đủ*\n` +
          `💰 Tổng số tiền: *${p.totalAmount.toLocaleString('vi-VN')}đ*\n\n` +
          `❤️ _Cảm ơn tất cả mọi người đã hoàn tất đóng tiền đầy đủ và đúng hạn!_ 🚀`;
        await this.telegram.sendMessage(p.group.chatId, celebrationMsg, p.group.threadId);
        console.log(`🎉 Đã gửi thông báo hoàn tất thu tiền 100% cho đợt "${p.batchTitle}"`);
      }
    } else {
      // Cảnh báo giao dịch chưa xác định đến Admin
      const alertMsg = 
        `⚠️ *CẢNH BÁO: GIAO DỊCH CHƯA XÁC ĐỊNH*\n\n` +
        `💰 Số tiền: *${incomingTx.amount.toLocaleString('vi-VN')}đ*\n` +
        `📝 Nội dung CK: \`${incomingTx.content}\`\n` +
        `🏦 STK nhận: \`${incomingTx.accountNumber}\`\n` +
        `⏰ Thời gian: ${incomingTx.transactionDate}\n` +
        `🔖 Mã GD: \`${transaction.id}\`\n\n` +
        `👉 _Vui lòng vào Web Dashboard để kiểm tra và gán thủ công._`;

      await this.telegram.sendAdminAlert(alertMsg);
      console.warn(`⚠️ Giao dịch chưa khớp: ${incomingTx.id} - ${incomingTx.content}`);
    }

    return { matched: match.matched, isDuplicate: false, transaction };
  }

  /**
   * Gán giao dịch thủ công từ Dashboard khi thành viên chuyển sai cú pháp
   */
  public async manualMatch(
    transactionId: string,
    serviceId: string,
    memberId: string,
    month: string
  ): Promise<Transaction> {
    let updatedTx: Transaction | undefined;
    let celebrationPayload: { group: Group; batchTitle: string; totalAmount: number; count: number } | null = null;

    await this.store.update(state => {
      const tx = state.transactions.find(t => t.id === transactionId);
      if (!tx) throw new Error('Giao dịch không tồn tại');

      const service = state.services.find(s => s.id === serviceId);
      if (!service) throw new Error('Dịch vụ không tồn tại');

      const member = (state.members[serviceId] || []).find(m => m.id === memberId);
      if (!member) throw new Error('Thành viên không tồn tại trong dịch vụ');

      const group = state.groups.find(g => g.id === service.groupId);

      tx.matched = true;
      tx.manualMatched = true;
      tx.groupId = service.groupId;
      tx.serviceId = serviceId;
      tx.memberId = memberId;
      tx.month = month;
      tx.note = `Gán thủ công lúc ${new Date().toLocaleString('vi-VN')}`;

      updatedTx = tx;

      // Cập nhật MonthlyMemberPayment
      const expected = service.mode === 'per_member' && member.customAmount
        ? member.customAmount
        : (service.defaultAmountPerMember || Math.round(service.totalAmount / (state.members[serviceId]?.length || 1)));

      let payment = state.monthlyPayments.find(
        p => p.serviceId === serviceId && p.memberId === memberId && p.month === month
      );

      if (!payment) {
        payment = {
          memberId: member.id,
          serviceId: service.id,
          month,
          expectedAmount: expected,
          paidAmount: tx.amount,
          status: tx.amount >= expected ? 'paid' : 'partial',
          transactionIds: [tx.id],
          paidAt: new Date().toISOString()
        };
        state.monthlyPayments.push(payment);
      } else {
        payment.paidAmount += tx.amount;
        payment.status = payment.paidAmount >= payment.expectedAmount ? 'paid' : 'partial';
        if (!payment.transactionIds.includes(tx.id)) {
          payment.transactionIds.push(tx.id);
        }
        payment.paidAt = new Date().toISOString();

        if (payment.qrMessageId && payment.qrChatId) {
          this.telegram.deleteMessage(payment.qrChatId, payment.qrMessageId).catch(() => {});
          payment.qrMessageId = undefined;
        }
      }

      // Cập nhật ExpenseBatch
      if (!state.expenseBatches) state.expenseBatches = [];
      let targetBatch = state.expenseBatches.find(b => 
        b.serviceId === serviceId && 
        b.status === 'active' && 
        b.members.some(m => m.memberId === memberId && m.status !== 'paid')
      );

      if (!targetBatch) {
        targetBatch = state.expenseBatches.find(b => 
          b.serviceId === serviceId && 
          (b.month === month || b.id.includes(month))
        );
      }

      if (targetBatch) {
        const batchMember = targetBatch.members.find(m => m.memberId === memberId);
        if (batchMember) {
          batchMember.paidAmount = (batchMember.paidAmount || 0) + tx.amount;
          batchMember.status = 'paid';
          batchMember.paidAt = new Date().toISOString();
          batchMember.transactionId = tx.id;

          if (batchMember.qrMessageId && batchMember.qrChatId) {
            this.telegram.deleteMessage(batchMember.qrChatId, batchMember.qrMessageId).catch(() => {});
            batchMember.qrMessageId = undefined;
          }
        }

        const isAllPaid = targetBatch.members.length > 0 && targetBatch.members.every(m => m.status === 'paid');
        if (isAllPaid && !targetBatch.completedNotificationSent) {
          targetBatch.status = 'completed';
          targetBatch.completedAt = new Date().toISOString();
          targetBatch.completedNotificationSent = true;

          if (group) {
            celebrationPayload = {
              group,
              batchTitle: targetBatch.title,
              totalAmount: targetBatch.totalAmount,
              count: targetBatch.members.length
            };
          }
        }
      }
    });

    if (celebrationPayload) {
      const p = celebrationPayload as { group: Group; batchTitle: string; totalAmount: number; count: number };
      const celebrationMsg = 
        `🎉 *TẤT CẢ THÀNH VIÊN ĐÃ HOÀN TẤT ĐÓNG TIỀN!* 🎉\n\n` +
        `📦 Đợt thu: *${p.batchTitle}*\n` +
        `👥 Tiến độ: *${p.count}/${p.count} thành viên đã đóng đủ*\n` +
        `💰 Tổng số tiền: *${p.totalAmount.toLocaleString('vi-VN')}đ*\n\n` +
        `❤️ _Cảm ơn tất cả mọi người đã hoàn tất đóng tiền đầy đủ và đúng hạn!_ 🚀`;
      await this.telegram.sendMessage(p.group.chatId, celebrationMsg, p.group.threadId);
    }

    return updatedTx!;
  }
}
