import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config.js';
import { JsonStore } from '../store/json-store.js';
import { SepayProvider } from '../providers/sepay.provider.js';
import { Service, Group, Member, MonthlyMemberPayment, ExpenseBatch, ExpenseBatchMemberItem, AppState } from '../types.js';

export interface MemberPaymentItem {
  type: 'service' | 'batch';
  service: Service;
  batch?: ExpenseBatch;
  member: Member | ExpenseBatchMemberItem;
  amount: number;
  transferCode: string;
  status: 'paid' | 'pending_verify' | 'unpaid';
}

export interface ResolvePaymentResult {
  success: boolean;
  error?: string;
  group?: Group;
  targetUsername?: string;
  memberName?: string;
  items: MemberPaymentItem[];
}

export class TelegramBotService {
  private static instance: TelegramBotService;
  private bot: Bot | null = null;
  private isRunning = false;
  private store: JsonStore;
  private bankProvider: SepayProvider;

  private constructor() {
    this.store = JsonStore.getInstance();
    this.bankProvider = new SepayProvider();
    if (config.BOT_TOKEN) {
      try {
        this.bot = new Bot(config.BOT_TOKEN);
        this.bot.catch((err) => {
          console.error('❌ [TELEGRAM BOT ERROR CAUGHT]:', err.error || err.message || err);
        });
        this.setupCommands();
      } catch (error) {
        console.error('❌ Lỗi khởi tạo Telegram Bot:', error);
      }
    } else {
      console.warn('⚠️ BOT_TOKEN chưa được cung cấp. Chế độ Mock Telegram đang bật.');
    }
  }

  public static getInstance(): TelegramBotService {
    if (!TelegramBotService.instance) {
      TelegramBotService.instance = new TelegramBotService();
    }
    return TelegramBotService.instance;
  }

  public resolveCollector(
    service?: Service,
    group?: Group,
    state?: any
  ): { chatId?: string; username?: string; tag: string } {
    let rawUsername = (service?.collectorUsername || '').replace(/^@/, '').trim().toLowerCase();
    let rawChatId = (service?.collectorChatId || '').trim();

    if (!rawUsername && !rawChatId && group) {
      rawUsername = (group.alertUsername || '').replace(/^@/, '').trim().toLowerCase();
      rawChatId = (group.alertChatId || '').trim();
    }

    if (!rawUsername && !rawChatId && state?.users) {
      const owner = state.users.find((u: any) => u.id === (service?.userId || group?.userId));
      if (owner) {
        rawUsername = (owner.telegramUsername || '').replace(/^@/, '').trim().toLowerCase();
        rawChatId = (owner.telegramChatId || '').trim();
      }
    }

    if (!rawUsername && !rawChatId && config.TELEGRAM_ADMIN_ID) {
      rawChatId = config.TELEGRAM_ADMIN_ID.trim();
    }

    // Nếu trường chatId chứa username (có chữ cái hoặc @)
    if (rawChatId && (rawChatId.startsWith('@') || /[a-zA-Z_]/.test(rawChatId))) {
      if (!rawUsername) rawUsername = rawChatId.replace(/^@/, '').toLowerCase().trim();
      rawChatId = '';
    }

    // Nếu trường username chứa số thuần
    if (rawUsername && /^-?\d+$/.test(rawUsername)) {
      if (!rawChatId) rawChatId = rawUsername;
      rawUsername = '';
    }

    // Tìm kiếm chatId từ username nếu chưa có
    let resolvedChatId = rawChatId;
    if (!resolvedChatId && rawUsername && state) {
      if (state.usernameMappings && state.usernameMappings[rawUsername]) {
        resolvedChatId = state.usernameMappings[rawUsername];
      } else {
        for (const sId of Object.keys(state.members || {})) {
          const mem = (state.members[sId] || []).find((m: any) => m.telegramUsername?.toLowerCase().trim() === rawUsername);
          if (mem?.telegramUserId) {
            resolvedChatId = mem.telegramUserId;
            break;
          }
        }
        if (!resolvedChatId && state.users) {
          const usr = state.users.find((u: any) => u.telegramUsername?.toLowerCase().trim() === rawUsername);
          if (usr?.telegramChatId) {
            resolvedChatId = usr.telegramChatId;
          }
        }
      }
    }

    const tag = rawUsername ? `@${rawUsername}` : (resolvedChatId ? `\`${resolvedChatId}\`` : 'Trưởng nhóm');

    return {
      chatId: resolvedChatId || undefined,
      username: rawUsername || undefined,
      tag
    };
  }

  public escapeMarkdown(text: string): string {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
  }

  private async safeSendQR(
    ctx: any,
    qrUrl: string,
    caption: string,
    replyMarkup: InlineKeyboard,
    replyToMessageId?: number
  ): Promise<number | undefined> {
    const plainCaption = caption.replace(/[*_`\\]/g, '');

    // 1. Thử gửi ảnh có caption Markdown
    try {
      const sent = await ctx.replyWithPhoto(qrUrl, {
        caption,
        parse_mode: 'Markdown',
        reply_to_message_id: replyToMessageId,
        reply_markup: replyMarkup
      });
      return sent?.message_id;
    } catch (e1: any) {
      console.warn('⚠️ Lỗi gửi ảnh QR dạng Markdown, thử gửi dạng text thường:', e1?.message);
    }

    // 2. Thử gửi ảnh có caption text thuần (không parse Markdown)
    try {
      const sent = await ctx.replyWithPhoto(qrUrl, {
        caption: plainCaption,
        reply_to_message_id: replyToMessageId,
        reply_markup: replyMarkup
      });
      return sent?.message_id;
    } catch (e2: any) {
      console.warn('⚠️ Lỗi gửi ảnh QR trực tiếp, fallback sang gửi link ảnh:', e2?.message);
    }

    // 3. Fallback gửi link Markdown
    try {
      const sent = await ctx.reply(`${caption}\n\n🖼 [Bấm vào đây để xem mã VietQR](${qrUrl})`, {
        parse_mode: 'Markdown',
        reply_to_message_id: replyToMessageId,
        reply_markup: replyMarkup
      });
      return sent?.message_id;
    } catch (e3: any) {
      console.warn('⚠️ Lỗi gửi link Markdown, gửi tin nhắn thường:', e3?.message);
    }

    // 4. Fallback gửi text thường
    try {
      const sent = await ctx.reply(`${plainCaption}\n\n🖼 Xem mã VietQR: ${qrUrl}`, {
        reply_to_message_id: replyToMessageId,
        reply_markup: replyMarkup
      });
      return sent?.message_id;
    } catch (e4: any) {
      console.error('❌ Không thể gửi tin nhắn QR:', e4?.message);
      return undefined;
    }
  }

  public resolveMemberPaymentInfo(
    params: {
      chatId: string;
      isGroup: boolean;
      senderUsername?: string;
      senderId?: string;
      senderName?: string;
      targetArg?: string;
    },
    state: AppState
  ): ResolvePaymentResult {
    const { chatId, isGroup, senderUsername, senderId, senderName, targetArg } = params;
    const cleanArg = (targetArg || '').trim();
    const cleanSenderUsername = (senderUsername || '').replace(/^@/, '').toLowerCase().trim();
    const cleanTarget = cleanArg ? cleanArg.replace(/^@/, '').toLowerCase().trim() : cleanSenderUsername;

    let targetGroup: Group | undefined;
    let relevantServices: Service[] = [];

    if (isGroup) {
      targetGroup = (state.groups || []).find(g => g.chatId === chatId);
      if (!targetGroup) {
        return {
          success: false,
          error: `⚠️ Nhóm này chưa được liên kết với Web Dashboard.\nChat ID của nhóm: \`${chatId}\`\nVui lòng thêm vào Dashboard để quản lý!`,
          items: []
        };
      }
      relevantServices = (state.services || []).filter(s => s.groupId === targetGroup!.id && s.active);
      if (relevantServices.length === 0) {
        return {
          success: false,
          error: `ℹ️ Nhóm *${targetGroup.title}* hiện chưa có dịch vụ nào đang hoạt động.`,
          items: []
        };
      }
    } else {
      // Direct message hoặc tìm trên tất cả dịch vụ đang kích hoạt
      relevantServices = (state.services || []).filter(s => s.active);
      if (relevantServices.length === 0) {
        return {
          success: false,
          error: `ℹ️ Hiện chưa có dịch vụ nào đang hoạt động trên hệ thống.`,
          items: []
        };
      }
    }

    const items: MemberPaymentItem[] = [];
    let matchedMemberName = '';
    let resolvedUsername = cleanTarget;

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 1. Kiểm tra các dịch vụ định kỳ (Monthly Services)
    for (const svc of relevantServices) {
      if (svc.scheduleType === 'on_demand') {
        // Dịch vụ thu theo đợt không có gói định kỳ hàng tháng -> chỉ thu qua ExpenseBatches
        continue;
      }

      const members = (state.members && state.members[svc.id]) || [];
      const m = members.find(mem => {
        if (!mem.active) return false;
        const memTag = (mem.telegramUsername || '').replace(/^@/, '').toLowerCase().trim();
        
        // 1. Khớp chính xác theo Telegram Tag Username (@username)
        if (cleanTarget && memTag) {
          if (memTag === cleanTarget) return true;
        }

        // 2. Nếu người dùng gõ /guitien có truyền tham số tìm theo tên hoặc mã CK (VD: /guitien NET-AN, /guitien Hoàng An)
        if (cleanArg) {
          if (mem.transferCode.toLowerCase() === cleanTarget) return true;
          if (mem.name.toLowerCase().includes(cleanTarget)) return true;
        }

        return false;
      });

      if (m) {
        if (!matchedMemberName) matchedMemberName = m.name;
        if (m.telegramUsername) resolvedUsername = m.telegramUsername.replace(/^@/, '').trim();

        // Kiểm tra xem có đợt thu tháng tương ứng hay không
        const monthlyBatch = (state.expenseBatches || []).find(
          b => b.serviceId === svc.id && (b.month === currentMonth || b.id === `batch_monthly_${svc.id}_${currentMonth}`) && b.status === 'active'
        );
        const batchMember = monthlyBatch?.members.find(bm => bm.memberId === m.id);

        const payment = (state.monthlyPayments || []).find(p => p.serviceId === svc.id && p.memberId === m.id && p.month === currentMonth);
        const amount = batchMember?.amount || (svc.mode === 'per_member' && m.customAmount
          ? m.customAmount
          : (svc.defaultAmountPerMember || Math.round(svc.totalAmount / (members.length || 1))));

        let status: 'paid' | 'pending_verify' | 'unpaid' = 'unpaid';
        if (payment?.status === 'paid' || batchMember?.status === 'paid') {
          status = 'paid';
        } else if (payment?.status === 'pending_verify' || batchMember?.status === 'pending_verify') {
          status = 'pending_verify';
        }

        if (monthlyBatch && batchMember) {
          items.push({
            type: 'batch',
            service: svc,
            batch: monthlyBatch,
            member: batchMember,
            amount,
            transferCode: batchMember.transferCode || m.transferCode,
            status
          });
        } else {
          items.push({
            type: 'service',
            service: svc,
            member: m,
            amount,
            transferCode: m.transferCode,
            status
          });
        }
      }
    }

    // 2. Kiểm tra các đợt thu phát sinh riêng (On-demand Expense Batches đang active)
    const activeBatches = (state.expenseBatches || []).filter(b => 
      b.status === 'active' && 
      b.batchType !== 'monthly' && 
      (relevantServices.some(s => s.id === b.serviceId) || (targetGroup && b.groupId === targetGroup.id))
    );

    for (const batch of activeBatches) {
      const bm = batch.members.find(bmem => {
        const bTag = (bmem.telegramUsername || '').replace(/^@/, '').toLowerCase().trim();
        if (cleanTarget && bTag) {
          if (bTag === cleanTarget) return true;
        }
        if (cleanArg) {
          if (bmem.transferCode.toLowerCase() === cleanTarget) return true;
          if (bmem.name.toLowerCase().includes(cleanTarget)) return true;
        }
        return false;
      });

      if (bm) {
        if (!matchedMemberName) matchedMemberName = bm.name;
        if (bm.telegramUsername) resolvedUsername = bm.telegramUsername.replace(/^@/, '').trim();

        const bStatus = bm.status === 'paid' ? 'paid' : (bm.status === 'pending_verify' ? 'pending_verify' : 'unpaid');
        const svc = relevantServices.find(s => s.id === batch.serviceId) || (state.services || []).find(s => s.id === batch.serviceId) || {
          id: batch.serviceId,
          name: batch.title,
          groupId: batch.groupId,
          scheduleType: 'on_demand',
          mode: 'per_member',
          totalAmount: batch.totalAmount,
          bankInfo: (relevantServices[0]?.bankInfo || state.services[0]?.bankInfo),
          messageTemplate: '',
          active: true,
          createdAt: '',
          updatedAt: ''
        } as Service;

        items.push({
          type: 'batch',
          service: svc,
          batch,
          member: bm,
          amount: bm.amount,
          transferCode: bm.transferCode,
          status: bStatus
        });
      }
    }

    if (items.length === 0) {
      if (!cleanTarget && !senderId) {
        return {
          success: false,
          error: `⚠️ Không thể xác định Telegram Username của bạn.\n💡 Vui lòng đặt Username trên Telegram hoặc dùng cú pháp: \`/guitien @username\``,
          items: []
        };
      }
      const displayTarget = cleanArg || (cleanTarget ? `@${cleanTarget}` : (senderName || 'bạn'));
      return {
        success: false,
        error: `⚠️ Không tìm thấy thành viên "${displayTarget}" trong danh sách dịch vụ của nhóm này.\n💡 Trưởng nhóm vui lòng kiểm tra lại cấu hình @username trên Web Dashboard.`,
        items: []
      };
    }

    return {
      success: true,
      group: targetGroup,
      targetUsername: resolvedUsername,
      memberName: matchedMemberName,
      items
    };
  }

  private setupCommands(): void {
    if (!this.bot) return;

    // Middleware tự động bắt và lưu ánh xạ username -> chatId
    this.bot.use(async (ctx, next) => {
      if (ctx.from?.username && ctx.from?.id) {
        const rawUsername = ctx.from.username.toLowerCase().trim();
        const userId = String(ctx.from.id);
        this.store.update(state => {
          if (!state.usernameMappings) state.usernameMappings = {};
          state.usernameMappings[rawUsername] = userId;
          for (const serviceId of Object.keys(state.members || {})) {
            for (const member of state.members[serviceId]) {
              if (member.telegramUsername && member.telegramUsername.toLowerCase().trim() === rawUsername && !member.telegramUserId) {
                member.telegramUserId = userId;
              }
            }
          }
          if (state.users) {
            for (const user of state.users) {
              if (user.telegramUsername && user.telegramUsername.toLowerCase().trim() === rawUsername && !user.telegramChatId) {
                user.telegramChatId = userId;
              }
            }
          }
        }).catch(() => {});
      }
      return next();
    });

    // Lệnh /start
    this.bot.command('start', async ctx => {
      const chatId = ctx.chat.id;
      const userId = String(ctx.from?.id);
      const username = ctx.from?.username;
      const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      
      // Nếu là chat riêng, tự động liên kết telegramUserId với thành viên tương ứng
      if (!isGroup && userId) {
        await this.store.update(state => {
          if (!state.usernameMappings) state.usernameMappings = {};
          if (username) {
            state.usernameMappings[username.toLowerCase().trim()] = userId;
          }
          for (const serviceId of Object.keys(state.members)) {
            for (const member of state.members[serviceId]) {
              if (username && member.telegramUsername && member.telegramUsername.toLowerCase() === username.toLowerCase()) {
                member.telegramUserId = userId;
              }
            }
          }
          if (state.users && state.users.length > 0) {
            const matchedUser = username 
              ? state.users.find(u => (u.telegramUsername && u.telegramUsername.toLowerCase() === username.toLowerCase()) || u.username.toLowerCase() === username.toLowerCase())
              : state.users[0];
            if (matchedUser) {
              matchedUser.telegramChatId = String(chatId);
            }
          }
          for (const g of state.groups) {
            if (!g.alertChatId) g.alertChatId = String(chatId);
          }
        });
      }

      let msg = `👋 *Xin chào! Tôi là Bot Nhắc Đóng Tiền Dịch Vụ Định Kỳ.*\n\n`;
      if (isGroup) {
        msg += `📌 *Thông tin nhóm này:*\n`;
        msg += `- Tên nhóm: *${ctx.chat.title || 'Không tên'}*\n`;
        msg += `- Chat ID: \`${chatId}\`\n`;
        if (ctx.message?.message_thread_id) {
          msg += `- Topic ID (Thread ID): \`${ctx.message.message_thread_id}\`\n`;
        }
        msg += `\n💡 _Dùng Chat ID này để thêm nhóm vào Web Dashboard quản trị._\n\n`;
      } else {
        msg += `📌 *Chat ID riêng của bạn:* \`${chatId}\`\n\n`;
        msg += `✅ *Bot đã lưu Chat ID của bạn để gửi thông báo duyệt tiền riêng!*\n`;
        msg += `Khi có thành viên trong nhóm bấm nút báo đã chuyển tiền, Bot sẽ gửi tin nhắn riêng kèm nút duyệt *[ ✅ Đã Nhận Tiền ]* đến đây cho bạn.\n\n`;
      }

      msg += `📋 *Danh sách lệnh:*\n`;
      msg += `• \`/guitien\` - Lấy mã VietQR chuyển tiền cá nhân hóa theo username\n`;
      msg += `• \`/danop @username\` - Đánh dấu thành viên đã nộp tiền nhanh\n`;
      msg += `• \`/status\` - Xem trạng thái đóng tiền dịch vụ tháng này\n`;
      msg += `• \`/chatid\` - Lấy Chat ID & Topic ID của nhóm\n`;
      msg += `• \`/help\` - Hướng dẫn chuyển khoản đúng cú pháp\n`;

      await ctx.reply(msg, { parse_mode: 'Markdown' });
    });

    // Lệnh /guitien, /ck, /pay, /qr, /chuyentien (Lấy mã VietQR chuyển tiền cá nhân hóa theo username trong nhóm)
    this.bot.command(['guitien', 'pay', 'ck', 'qr', 'chuyentien'], async ctx => {
      const chatId = String(ctx.chat.id);
      const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      const senderUsername = ctx.from?.username;
      const senderId = String(ctx.from?.id || '');
      const senderName = ctx.from?.first_name || '';
      const targetArg = (ctx.match || '').trim();

      const state = await this.store.read();
      const result = this.resolveMemberPaymentInfo(
        {
          chatId,
          isGroup,
          senderUsername,
          senderId,
          senderName,
          targetArg
        },
        state
      );

      if (!result.success) {
        await ctx.reply(result.error!, {
          parse_mode: 'Markdown',
          reply_to_message_id: ctx.message?.message_id
        });
        return;
      }

      const { items, targetUsername, memberName } = result;
      const unpaidItems = items.filter(it => it.status !== 'paid');

      const tag = targetUsername ? `@${targetUsername}` : (memberName ? `*${memberName}*` : 'bạn');

      if (unpaidItems.length === 0) {
        await ctx.reply(
          `✅ *HOÀN TẤT ĐÓNG TIỀN*\n\n` +
          `👤 Thành viên: ${tag}\n` +
          `🎉 Bạn đã hoàn tất đóng toàn bộ tiền dịch vụ trong nhóm này!\n` +
          `Cảm ơn bạn đã thanh toán đúng hạn! 🚀`,
          {
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message?.message_id
          }
        );
        return;
      }

      // Tự động liên kết telegramUserId nếu chưa có
      if (senderId && (!targetArg || targetUsername === (senderUsername || '').toLowerCase().trim())) {
        await this.store.update(s => {
          for (const item of unpaidItems) {
            const memberId = 'memberId' in item.member ? item.member.memberId : item.member.id;
            const mList = s.members[item.service.id] || [];
            const mObj = mList.find(m => m.id === memberId);
            if (mObj && !mObj.telegramUserId) {
              mObj.telegramUserId = senderId;
            }
          }
        });
      }

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // Gửi mã QR cho từng dịch vụ / đợt thu chưa thanh toán
      for (const item of unpaidItems) {
        const svc = item.service;
        const m = item.member;
        const bankInfo = svc.bankInfo;

        if (!bankInfo || !bankInfo.accountNumber) {
          await ctx.reply(
            `⚠️ Dịch vụ *${svc.name}* chưa được cấu hình thông tin tài khoản ngân hàng nhận tiền.`,
            { parse_mode: 'Markdown', reply_to_message_id: ctx.message?.message_id }
          );
          continue;
        }

        let fullTransferCode = item.transferCode.trim();
        const prefix = (svc.transferPrefix || '').trim();
        if (prefix && !fullTransferCode.toUpperCase().startsWith(prefix.toUpperCase())) {
          fullTransferCode = `${prefix} ${fullTransferCode}`;
        }

        const qrUrl = this.bankProvider.generateQRUrl({
          bankInfo,
          amount: item.amount,
          description: fullTransferCode,
          template: 'compact2'
        });

        const isSepayMode = svc.verificationMode === 'sepay';
        const serviceTitle = item.type === 'batch' && item.batch ? `${item.batch.title} (${svc.name})` : svc.name;
        const mName = (m.name || '').replace(/[*_`]/g, '');
        const mTag = (m.telegramUsername || targetUsername || '').replace(/^@/, '');
        const escapedTag = this.escapeMarkdown(mTag);
        const safeServiceTitle = serviceTitle.replace(/[*_`]/g, '');
        const safeBankCode = (bankInfo.bankCode || '').replace(/[*_`]/g, '');
        const safeAccountName = (bankInfo.accountName || '').replace(/[*_`]/g, '');
        const safeAccountNumber = (bankInfo.accountNumber || '').replace(/[*_`]/g, '');
        const safeTransferCode = fullTransferCode.replace(/[`\\]/g, '');

        let caption =
          `👤 *MÃ THANH TOÁN VIETQR: ${mName.toUpperCase()}*\n` +
          (escapedTag ? `🏷️ Tag: @${escapedTag}\n` : '') +
          `📦 Dịch vụ: *${safeServiceTitle}*\n` +
          `💰 Số tiền: *${item.amount.toLocaleString('vi-VN')}đ*\n` +
          `📝 Nội dung CK: \`${safeTransferCode}\`\n` +
          `🏦 Ngân hàng: *${safeBankCode}*\n` +
          `💳 STK: \`${safeAccountNumber}\`\n` +
          `👤 Chủ TK: *${safeAccountName}*\n\n`;

        if (item.status === 'pending_verify') {
          caption += `⏳ *Trạng thái:* Đang chờ Trưởng nhóm duyệt xác nhận!\n\n`;
        }

        caption += isSepayMode
          ? `⚡ _Mã QR đã có sẵn số tiền & nội dung chính xác. Sau khi chuyển khoản, SePay sẽ tự động đối soát và xác nhận trong 5-30 giây!_`
          : `⚡ _Quét mã bằng App ngân hàng để thanh toán, sau khi CK xong bấm nút bên dưới để báo Trưởng nhóm duyệt:_`;

        const memberId = 'memberId' in m ? m.memberId : m.id;
        const selfPayCallback = item.type === 'batch' && item.batch
          ? `self_pay_batch:${item.batch.id}:${memberId}`
          : `self_pay_svc:${svc.id}:${memberId}`;

        const replyMarkup = new InlineKeyboard().text('📩 Tôi Đã Chuyển Tiền Xong', selfPayCallback);

        const sentMessageId = await this.safeSendQR(
          ctx,
          qrUrl,
          caption,
          replyMarkup,
          ctx.message?.message_id
        );

        // Lưu qrMessageId để tự động xóa khi đã xác nhận thanh toán
        if (sentMessageId) {
          const targetChatId = String(ctx.chat.id);
          await this.store.update(s => {
            if (item.type === 'batch' && item.batch) {
              const b = (s.expenseBatches || []).find(batch => batch.id === item.batch!.id);
              const bm = b?.members.find(mem => mem.memberId === memberId);
              if (bm) {
                if (bm.qrMessageId && bm.qrChatId) {
                  this.deleteMessage(bm.qrChatId, bm.qrMessageId).catch(() => {});
                }
                bm.qrMessageId = sentMessageId;
                bm.qrChatId = targetChatId;
              }
            } else {
              const payment = s.monthlyPayments.find(p => p.serviceId === svc.id && p.memberId === memberId && p.month === currentMonth);
              if (!payment) {
                const newPayment: MonthlyMemberPayment = {
                  memberId,
                  serviceId: svc.id,
                  month: currentMonth,
                  expectedAmount: item.amount,
                  paidAmount: 0,
                  status: item.status === 'pending_verify' ? 'pending_verify' : 'unpaid',
                  transactionIds: [],
                  qrMessageId: sentMessageId,
                  qrChatId: targetChatId
                };
                s.monthlyPayments.push(newPayment);
              } else {
                if (payment.qrMessageId && payment.qrChatId) {
                  this.deleteMessage(payment.qrChatId, payment.qrMessageId).catch(() => {});
                }
                payment.qrMessageId = sentMessageId;
                payment.qrChatId = targetChatId;
              }
            }
          });
        }
      }
    });

    // Lệnh /danop @username (Đánh dấu nhanh đã nộp tiền trong nhóm)
    this.bot.command('danop', async ctx => {
      const chatId = String(ctx.chat.id);
      const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      if (!isGroup) {
        await ctx.reply('⚠️ Lệnh này chỉ dùng trong nhóm Telegram liên kết.', { parse_mode: 'Markdown' });
        return;
      }

      const text = (ctx.match || '').trim();
      if (!text) {
        await ctx.reply('ℹ️ Cú pháp: `/danop @username` hoặc `/danop Tên_thành_viên`', { parse_mode: 'Markdown' });
        return;
      }

      const cleanTarget = text.replace(/^@/, '').toLowerCase().trim();
      const state = await this.store.read();
      const group = state.groups.find(g => g.chatId === chatId);

      if (!group) {
        await ctx.reply('⚠️ Nhóm này chưa được liên kết với Web Dashboard.', { parse_mode: 'Markdown' });
        return;
      }

      const services = state.services.filter(s => s.groupId === group.id && s.active);
      let matchedMember: any = null;
      let targetService: Service | undefined;

      for (const svc of services) {
        const members = state.members[svc.id] || [];
        const m = members.find(
          mem => (mem.telegramUsername && mem.telegramUsername.toLowerCase() === cleanTarget) ||
                 mem.name.toLowerCase().includes(cleanTarget)
        );
        if (m) {
          matchedMember = m;
          targetService = svc;
          break;
        }
      }

      if (!matchedMember || !targetService) {
        await ctx.reply(`⚠️ Không tìm thấy thành viên "${text}" trong các dịch vụ của nhóm này.`, { parse_mode: 'Markdown' });
        return;
      }

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const amount = targetService.mode === 'per_member' && matchedMember.customAmount
        ? matchedMember.customAmount
        : (targetService.defaultAmountPerMember || Math.round(targetService.totalAmount / (state.members[targetService.id]?.length || 1)));

      // Cập nhật trạng thái
      await this.store.update(s => {
        let payment = s.monthlyPayments.find(p => p.serviceId === targetService!.id && p.memberId === matchedMember.id && p.month === currentMonth);
        if (!payment) {
          payment = {
            memberId: matchedMember.id,
            serviceId: targetService!.id,
            month: currentMonth,
            expectedAmount: amount,
            paidAmount: amount,
            status: 'paid',
            transactionIds: [],
            paidAt: new Date().toISOString()
          };
          s.monthlyPayments.push(payment);
        } else {
          payment.paidAmount = amount;
          payment.status = 'paid';
          payment.paidAt = new Date().toISOString();
        }

        // Cập nhật đợt thu nếu có
        for (const batch of (s.expenseBatches || [])) {
          if (batch.serviceId === targetService!.id && batch.status === 'active') {
            const bm = batch.members.find(m => m.memberId === matchedMember.id);
            if (bm) {
              bm.status = 'paid';
              bm.paidAmount = amount;
              bm.paidAt = new Date().toISOString();
              if (bm.qrMessageId && bm.qrChatId) {
                this.deleteMessage(bm.qrChatId, bm.qrMessageId).catch(() => {});
              }
            }
          }
        }
      });

      const tag = matchedMember.telegramUsername ? `@${matchedMember.telegramUsername}` : `*${matchedMember.name}*`;
      await ctx.reply(
        `✅ *ĐÃ ĐÁNH DẤU HOÀN TẤT ĐÓNG TIỀN*\n\n` +
        `👤 Thành viên: ${tag}\n` +
        `📦 Dịch vụ: *${targetService.name}*\n` +
        `💰 Số tiền: *${amount.toLocaleString('vi-VN')}đ*\n\n` +
        `🎉 _Cảm ơn bạn! Hệ thống đã ghi nhận thành công._ 🚀`,
        { parse_mode: 'Markdown' }
      );
    });

    // Lệnh /chatid
    this.bot.command('chatid', async ctx => {
      const chatId = ctx.chat.id;
      const threadId = ctx.message?.message_thread_id;
      const title = 'title' in ctx.chat ? ctx.chat.title : ctx.from?.first_name || 'Direct Chat';

      let msg = `🏷️ *Thông tin Telegram Chat*\n\n`;
      msg += `• *Tên:* ${title}\n`;
      msg += `• *Chat ID:* \`${chatId}\`\n`;
      if (threadId) {
        msg += `• *Topic ID (Thread ID):* \`${threadId}\`\n`;
      }
      msg += `\n_Sao chép Chat ID trên và dán vào phần cài đặt Nhóm trên Web Dashboard._`;

      await ctx.reply(msg, { parse_mode: 'Markdown' });
    });

    // Lệnh /status
    this.bot.command('status', async ctx => {
      const chatId = String(ctx.chat.id);
      const group = await this.store.getGroupByChatId(chatId);

      if (!group) {
        await ctx.reply(
          `⚠️ Nhóm này chưa được liên kết trong Web Dashboard.\nChat ID của nhóm: \`${chatId}\`\nVui lòng thêm vào Dashboard để quản lý!`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const services = await this.store.getServices(group.id);
      if (services.length === 0) {
        await ctx.reply(`ℹ️ Nhóm *${group.title}* hiện chưa cấu hình dịch vụ nào.`, { parse_mode: 'Markdown' });
        return;
      }

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      let msg = `📊 *TRẠNG THÁI DỊCH VỤ THÁNG ${now.getMonth() + 1}/${now.getFullYear()}*\n\n`;

      for (const svc of services) {
        if (!svc.active) continue;
        const members = await this.store.getMembers(svc.id);
        const state = await this.store.read();
        
        msg += `🔹 *${svc.name}* (Ngày nhắc: ${svc.reminderDay} hàng tháng)\n`;
        msg += `• Tổng tiền: *${svc.totalAmount.toLocaleString('vi-VN')}đ*\n`;
        msg += `• Danh sách thành viên:\n`;

        for (const m of members) {
          if (!m.active) continue;
          const payment = state.monthlyPayments.find(p => p.serviceId === svc.id && p.memberId === m.id && p.month === currentMonth);
          const isPaid = payment && payment.status === 'paid';
          const isPending = payment && payment.status === 'pending_verify';
          const icon = isPaid ? '✅' : (isPending ? '⏳' : '❌');
          const tag = m.telegramUsername ? `@${m.telegramUsername}` : m.name;
          const statusText = isPaid ? 'Đã đóng' : (isPending ? 'Chờ duyệt' : 'Chưa đóng');
          msg += `  ${icon} ${tag} (\`${m.transferCode}\`): *${statusText}*\n`;
        }
        msg += `\n`;
      }

      await ctx.reply(msg, { parse_mode: 'Markdown' });
    });

    // Lệnh /help
    this.bot.command('help', async ctx => {
      let msg = `📖 *HƯỚNG DẪN ĐÓNG TIỀN & XÁC THỰC*\n\n`;
      msg += `1️⃣ Gõ lệnh \`/guitien\` (hoặc \`/ck\`, \`/pay\`) trong nhóm để lấy ngay mã *VietQR cá nhân hóa* của bạn.\n`;
      msg += `2️⃣ Quét mã QR bằng App ngân hàng để chuyển khoản đúng số tiền và nội dung.\n`;
      msg += `3️⃣ Chuyển khoản xong, bấm nút *[ 📩 Tôi Đã Chuyển Tiền Xong ]* dưới ảnh QR để báo cho Trưởng nhóm.\n`;
      msg += `4️⃣ Trưởng nhóm sẽ nhận được tin nhắn riêng và bấm duyệt 1-click để xác nhận cho bạn! 🎉\n`;

      await ctx.reply(msg, { parse_mode: 'Markdown' });
    });

    // Xử lý các Callback Queries (Nút bấm trên tin nhắn)
    this.bot.on('callback_query:data', async ctx => {
      const data = ctx.callbackQuery.data;
      const userId = String(ctx.from?.id);

      if (!data) return;

      // =========================================================================
      // 1. THÀNH VIÊN BẤM TÊN ĐỂ LẤY MÃ QR VIETQR CÁ NHÂN
      // =========================================================================
      if (data.startsWith('pay_batch:') || data.startsWith('pay_svc:')) {
        const state = await this.store.read();

        let memberName = '';
        let memberTag = '';
        let transferCode = '';
        let amount = 0;
        let serviceName = '';
        let batchTitle = '';
        let bankInfo: any = null;
        let currentService: Service | undefined;

        if (data.startsWith('pay_batch:')) {
          const [, batchId, memberId] = data.split(':');
          const batch = (state.expenseBatches || []).find(b => b.id === batchId);
          const service = state.services.find(s => s.id === batch?.serviceId);
          const memItem = batch?.members.find(m => m.memberId === memberId);

          if (batch && service && memItem) {
            currentService = service;
            memberName = memItem.name;
            memberTag = memItem.telegramUsername || '';
            transferCode = memItem.transferCode;
            amount = memItem.amount;
            serviceName = service.name;
            batchTitle = batch.title;
            bankInfo = service.bankInfo;

            const senderTag = (ctx.from?.username || '').replace(/^@/, '').toLowerCase().trim();
            const targetTag = (memItem.telegramUsername || '').replace(/^@/, '').toLowerCase().trim();
            if (userId && senderTag && targetTag && senderTag === targetTag) {
              await this.store.update(s => {
                const mList = s.members[service.id] || [];
                const mObj = mList.find(m => m.id === memberId);
                if (mObj && !mObj.telegramUserId) mObj.telegramUserId = userId;
              });
            }
          }
        } else if (data.startsWith('pay_svc:')) {
          const [, serviceId, memberId] = data.split(':');
          const service = state.services.find(s => s.id === serviceId);
          const member = (state.members[serviceId] || []).find(m => m.id === memberId);

          if (service && member) {
            currentService = service;
            memberName = member.name;
            memberTag = member.telegramUsername || '';
            transferCode = member.transferCode;
            amount = service.mode === 'per_member' && member.customAmount
              ? member.customAmount
              : (service.defaultAmountPerMember || Math.round(service.totalAmount / (state.members[serviceId]?.length || 1)));
            serviceName = service.name;
            batchTitle = `${service.name} (Định kỳ)`;
            bankInfo = service.bankInfo;

            const senderTag = (ctx.from?.username || '').replace(/^@/, '').toLowerCase().trim();
            const targetTag = (member.telegramUsername || '').replace(/^@/, '').toLowerCase().trim();
            if (userId && senderTag && targetTag && senderTag === targetTag) {
              await this.store.update(s => {
                const mList = s.members[serviceId] || [];
                const mObj = mList.find(m => m.id === memberId);
                if (mObj && !mObj.telegramUserId) mObj.telegramUserId = userId;
              });
            }
          }
        }

        if (bankInfo && transferCode && amount > 0) {
          let fullTransferCode = transferCode.trim();
          const prefix = (currentService?.transferPrefix || '').trim();
          if (prefix && !fullTransferCode.toUpperCase().startsWith(prefix.toUpperCase())) {
            fullTransferCode = `${prefix} ${fullTransferCode}`;
          }

          const qrUrl = this.bankProvider.generateQRUrl({
            bankInfo,
            amount,
            description: fullTransferCode,
            template: 'compact2'
          });

          const isSepayMode = currentService?.verificationMode === 'sepay';
          const safeMemberName = (memberName || '').replace(/[*_`]/g, '');
          const safeMemberTag = (memberTag || '').replace(/^@/, '');
          const escapedTag = this.escapeMarkdown(safeMemberTag);
          const safeServiceTitle = (serviceName || '').replace(/[*_`]/g, '');
          const safeBankCode = (bankInfo.bankCode || '').replace(/[*_`]/g, '');
          const safeAccountName = (bankInfo.accountName || '').replace(/[*_`]/g, '');
          const safeAccountNumber = (bankInfo.accountNumber || '').replace(/[*_`]/g, '');
          const safeTransferCode = fullTransferCode.replace(/[`\\]/g, '');

          const caption =
            `👤 *MÃ THANH TOÁN VIETQR: ${safeMemberName.toUpperCase()}*\n` +
            (escapedTag ? `🏷️ Tag: @${escapedTag}\n` : '') +
            `📦 Dịch vụ: *${safeServiceTitle}*\n` +
            `💰 Số tiền: *${amount.toLocaleString('vi-VN')}đ*\n` +
            `📝 Nội dung CK: \`${safeTransferCode}\`\n` +
            `🏦 Ngân hàng: *${safeBankCode}*\n` +
            `💳 STK: \`${safeAccountNumber}\`\n` +
            `👤 Chủ TK: *${safeAccountName}*\n\n` +
            (isSepayMode
              ? `⚡ _Mã QR đã có sẵn số tiền & nội dung chính xác. Sau khi chuyển khoản, SePay sẽ tự động đối soát và xác nhận trong 5-30 giây!_`
              : `⚡ _Quét mã bằng App ngân hàng để thanh toán, sau khi CK xong bấm nút bên dưới để báo Trưởng nhóm duyệt:_`);

          // Gắn nút "Tôi Đã Chuyển Tiền" dưới ảnh QR
          const selfPayCallback = data.startsWith('pay_batch:')
            ? `self_pay_batch:${data.split(':')[1]}:${data.split(':')[2]}`
            : `self_pay_svc:${data.split(':')[1]}:${data.split(':')[2]}`;

          const replyMarkup = new InlineKeyboard().text('📩 Tôi Đã Chuyển Tiền Xong', selfPayCallback);
          const chatId = String(ctx.chat?.id || ctx.callbackQuery.message?.chat.id || '');

          const sentMessageId = await this.safeSendQR(
            ctx,
            qrUrl,
            caption,
            replyMarkup,
            ctx.callbackQuery.message?.message_id
          );

          // Lưu qrMessageId để tự động xóa khi thành viên này chuyển khoản xong
          if (sentMessageId && chatId) {
            if (data.startsWith('pay_batch:')) {
              const [, batchId, memberId] = data.split(':');
              await this.store.update(s => {
                const b = (s.expenseBatches || []).find(b => b.id === batchId);
                const m = b?.members.find(m => m.memberId === memberId);
                if (m) {
                  if (m.qrMessageId && m.qrChatId) {
                    this.deleteMessage(m.qrChatId, m.qrMessageId).catch(() => {});
                  }
                  m.qrMessageId = sentMessageId;
                  m.qrChatId = chatId;
                }
              });
            } else if (data.startsWith('pay_svc:')) {
              const [, serviceId, memberId] = data.split(':');
              const now = new Date();
              const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
              await this.store.update(s => {
                const p = s.monthlyPayments.find(p => p.serviceId === serviceId && p.memberId === memberId && p.month === currentMonth);
                if (p) {
                  if (p.qrMessageId && p.qrChatId) {
                    this.deleteMessage(p.qrChatId, p.qrMessageId).catch(() => {});
                  }
                  p.qrMessageId = sentMessageId;
                  p.qrChatId = chatId;
                }
              });
            }
          }

          await ctx.answerCallbackQuery({
            text: `✅ Đã tạo mã VietQR cho ${memberName} (${amount.toLocaleString('vi-VN')}đ)!`
          });
          return;
        }
      }

      // =========================================================================
      // 2. THÀNH VIÊN BẤM "TÔI ĐÃ CHUYỂN TIỀN" ➔ GỬI TIN NHẮN RIÊNG CHO TRƯỞNG NHÓM
      // =========================================================================
      if (data.startsWith('self_pay_batch:') || data.startsWith('self_pay_svc:')) {
        const state = await this.store.read();
        const isBatch = data.startsWith('self_pay_batch:');
        const targetId = data.split(':')[1];
        const memberId = data.split(':')[2];

        let memberName = '';
        let memberTag = '';
        let serviceName = '';
        let amount = 0;
        let transferCode = '';
        let groupTitle = '';
        let groupId = '';
        let serviceId = '';

        if (isBatch) {
          const batch = (state.expenseBatches || []).find(b => b.id === targetId);
          const service = state.services.find(s => s.id === batch?.serviceId);
          const group = state.groups.find(g => g.id === batch?.groupId || g.id === service?.groupId);
          const memberItem = batch?.members.find(m => m.memberId === memberId);

          if (!batch || !memberItem) {
            await ctx.answerCallbackQuery({ text: '⚠️ Đợt thu không tồn tại hoặc đã kết thúc.' });
            return;
          }

          if (memberItem.status === 'paid') {
            await ctx.answerCallbackQuery({ text: '✅ Bạn đã được ghi nhận thanh toán rồi!' });
            return;
          }

          memberName = memberItem.name;
          memberTag = memberItem.telegramUsername || '';
          serviceName = batch.title;
          amount = memberItem.amount;
          transferCode = memberItem.transferCode;
          groupTitle = group?.title || 'Nhóm chung';
          groupId = group?.id || '';
          serviceId = batch.serviceId;

          // Cập nhật trạng thái chờ duyệt
          await this.store.update(s => {
            const b = (s.expenseBatches || []).find(b => b.id === targetId);
            const m = b?.members.find(m => m.memberId === memberId);
            if (m) m.status = 'pending_verify';
          });
        } else {
          const service = state.services.find(s => s.id === targetId);
          const group = state.groups.find(g => g.id === service?.groupId);
          const member = (state.members[targetId] || []).find(m => m.id === memberId);

          if (!service || !member) {
            await ctx.answerCallbackQuery({ text: '⚠️ Dịch vụ hoặc thành viên không tồn tại.' });
            return;
          }

          const now = new Date();
          const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const payment = state.monthlyPayments.find(p => p.serviceId === targetId && p.memberId === memberId && p.month === currentMonth);

          if (payment && payment.status === 'paid') {
            await ctx.answerCallbackQuery({ text: '✅ Bạn đã được ghi nhận thanh toán rồi!' });
            return;
          }

          memberName = member.name;
          memberTag = member.telegramUsername || '';
          serviceName = service.name;
          amount = service.mode === 'per_member' && member.customAmount
            ? member.customAmount
            : (service.defaultAmountPerMember || Math.round(service.totalAmount / (state.members[targetId]?.length || 1)));
          transferCode = member.transferCode;
          groupTitle = group?.title || 'Nhóm chung';
          groupId = group?.id || '';
          serviceId = service.id;

          // Cập nhật trạng thái chờ duyệt
          await this.store.update(s => {
            let p = s.monthlyPayments.find(pay => pay.serviceId === targetId && pay.memberId === memberId && pay.month === currentMonth);
            if (!p) {
              s.monthlyPayments.push({
                memberId: member.id,
                serviceId: targetId,
                month: currentMonth,
                expectedAmount: amount,
                paidAmount: 0,
                status: 'pending_verify',
                transactionIds: []
              });
            } else {
              p.status = 'pending_verify';
            }
          });
        }

        const tag = memberTag ? `@${memberTag}` : `*${memberName}*`;
        const groupObj = state.groups.find(g => g.id === groupId);
        const serviceObj = state.services.find(s => s.id === serviceId);
        const ownerUser = (state.users || []).find(u => u.id === (groupObj?.userId || serviceObj?.userId));

        // Format lại mã chuyển khoản đầy đủ
        let fullTransferCode = transferCode.trim();
        const prefix = (serviceObj?.transferPrefix || '').trim();
        if (prefix && !fullTransferCode.toUpperCase().startsWith(prefix.toUpperCase())) {
          fullTransferCode = `${prefix} ${fullTransferCode}`;
        }

        // Xóa ngay tin nhắn chứa ảnh QR của thành viên này trong nhóm
        const currentMsgId = ctx.callbackQuery.message?.message_id;
        const currentChatId = String(ctx.chat?.id || ctx.callbackQuery.message?.chat.id || '');
        if (currentMsgId && currentChatId) {
          this.deleteMessage(currentChatId, currentMsgId).catch(() => {});
        }

        // Xác định thông tin Người Thu Tiền / Người Duyệt (Dịch vụ -> Nhóm -> User -> Admin)
        const collector = this.resolveCollector(serviceObj, groupObj, state);
        const groupChatId = groupObj?.chatId || ctx.chat?.id;

        const approveData = isBatch ? `admin_approve_batch:${targetId}:${memberId}` : `admin_approve_svc:${targetId}:${memberId}`;
        const rejectData = isBatch ? `admin_reject_batch:${targetId}:${memberId}` : `admin_reject_svc:${targetId}:${memberId}`;

        const verifyKeyboard = new InlineKeyboard()
          .text('✅ Đã Nhận Tiền', approveData)
          .text('❌ Chưa Thấy Tiền', rejectData);

        let dmSuccess = false;

        // Nếu có Chat ID riêng, thử gửi tin nhắn riêng cho người duyệt trước
        if (collector.chatId) {
          const verifyTextDM =
            `🔔 *YÊU CẦU XÁC NHẬN CHUYỂN KHOẢN (DUYỆT TIỀN)*\n\n` +
            `👥 *Nhóm:* ${groupTitle}\n` +
            `📦 *Dịch vụ / Đợt thu:* *${serviceName}*\n` +
            `👤 *Thành viên:* ${tag} (\`${memberName}\`)\n` +
            `💰 *Số tiền:* *${amount.toLocaleString('vi-VN')}đ*\n` +
            `📝 *Nội dung CK:* \`${fullTransferCode}\`\n` +
            `⏰ *Thời gian:* ${new Date().toLocaleTimeString('vi-VN')} ${new Date().toLocaleDateString('vi-VN')}\n\n` +
            `👇 *Vui lòng kiểm tra App ngân hàng xem tiền đã vào chưa và bấm duyệt:*`;

          try {
            await this.bot?.api.sendMessage(collector.chatId, verifyTextDM, {
              parse_mode: 'Markdown',
              reply_markup: verifyKeyboard
            });
            dmSuccess = true;
          } catch (sendErr: any) {
            console.warn(`⚠️ Không thể gửi tin nhắn riêng tới ${collector.chatId}, chuyển sang thông báo vào nhóm:`, sendErr?.message || sendErr);
          }
        }

        if (dmSuccess) {
          await ctx.answerCallbackQuery({
            text: `🔔 Đã gửi tin nhắn riêng cho ${collector.tag} duyệt tiền!`
          });

          // Bắn thông báo ngắn vào nhóm để mọi người cùng biết
          if (groupChatId) {
            await this.sendMessage(
              String(groupChatId),
              `⏳ ${tag} vừa báo đã chuyển khoản *${amount.toLocaleString('vi-VN')}đ* cho *${serviceName}*! Bot đã gửi tin nhắn riêng cho ${collector.tag} để xác nhận.`,
              groupObj?.threadId
            );
          }
        } else {
          // CHẾ ĐỘ HYBRID: Nếu chưa có Chat ID riêng hoặc gửi DM thất bại -> Gửi thông báo kèm nút duyệt trực tiếp vào nhóm và Tag @username
          const verifyTextGroup =
            `🔔 *YÊU CẦU XÁC NHẬN CHUYỂN KHOẢN (DUYỆT TIỀN)*\n\n` +
            `👑 *Người duyệt:* ${collector.tag}\n` +
            `👤 *Thành viên:* ${tag} (\`${memberName}\`)\n` +
            `📦 *Dịch vụ / Đợt thu:* *${serviceName}*\n` +
            `💰 *Số tiền:* *${amount.toLocaleString('vi-VN')}đ*\n` +
            `📝 *Nội dung CK:* \`${fullTransferCode}\`\n` +
            `⏰ *Thời gian:* ${new Date().toLocaleTimeString('vi-VN')} ${new Date().toLocaleDateString('vi-VN')}\n\n` +
            `👇 *${collector.tag} (hoặc Quản trị viên) vui lòng kiểm tra App ngân hàng và bấm xác nhận:*`;

          if (groupChatId) {
            await this.bot?.api.sendMessage(String(groupChatId), verifyTextGroup, {
              parse_mode: 'Markdown',
              message_thread_id: groupObj?.threadId,
              reply_markup: verifyKeyboard
            });
          }

          await ctx.answerCallbackQuery({
            text: `🔔 Đã gửi yêu cầu xác nhận vào nhóm cho ${collector.tag} duyệt!`
          });
        }
        return;
      }


      // =========================================================================
      // 3. XÁC NHẬN "ĐÃ NHẬN TIỀN" (APPROVE) TRONG TIN NHẮN RIÊNG HOẶC NHÓM
      // =========================================================================
      if (data.startsWith('admin_approve_batch:') || data.startsWith('admin_approve_svc:')) {
        const state = await this.store.read();
        const isBatch = data.startsWith('admin_approve_batch:');
        const targetId = data.split(':')[1];
        const memberId = data.split(':')[2];

        const isGroupChat = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
        const fromId = String(ctx.from?.id);
        const fromUsername = (ctx.from?.username || '').toLowerCase().trim();

        const serviceObj = isBatch 
          ? state.services.find(s => s.id === (state.expenseBatches || []).find(b => b.id === targetId)?.serviceId)
          : state.services.find(s => s.id === targetId);
        const groupObj = isBatch
          ? state.groups.find(g => g.id === (state.expenseBatches || []).find(b => b.id === targetId)?.groupId || g.id === serviceObj?.groupId)
          : state.groups.find(g => g.id === serviceObj?.groupId);

        const collector = this.resolveCollector(serviceObj, groupObj, state);

        // Phân quyền nếu bấm trong nhóm chung
        if (isGroupChat) {
          const isMatchingUser = 
            (collector.chatId && fromId === collector.chatId) ||
            (collector.username && fromUsername === collector.username) ||
            (config.TELEGRAM_ADMIN_ID && fromId === config.TELEGRAM_ADMIN_ID);

          let isGroupAdmin = false;
          if (!isMatchingUser && ctx.chat?.id && ctx.from?.id) {
            try {
              const memberChatInfo = await ctx.getChatMember(ctx.from.id);
              if (memberChatInfo.status === 'creator' || memberChatInfo.status === 'administrator') {
                isGroupAdmin = true;
              }
            } catch (e) {}
          }

          if (!isMatchingUser && !isGroupAdmin) {
            const authorizedName = collector.tag || 'Trưởng nhóm / Quản trị viên';
            await ctx.answerCallbackQuery({
              text: `⚠️ Chỉ ${authorizedName} mới có quyền duyệt giao dịch này!`,
              show_alert: true
            });
            return;
          }
        }

        let memberName = '';
        let memberTag = '';
        let serviceName = '';
        let amount = 0;
        let qrMsgId: number | undefined;
        let qrChatId: string | undefined;
        let isAllCompleted = false;

        if (isBatch) {
          const batch = (state.expenseBatches || []).find(b => b.id === targetId);
          const memberItem = batch?.members.find(m => m.memberId === memberId);

          if (batch && memberItem) {
            memberName = memberItem.name;
            memberTag = memberItem.telegramUsername || '';
            serviceName = batch.title;
            amount = memberItem.amount;
            qrMsgId = memberItem.qrMessageId;
            qrChatId = memberItem.qrChatId;

            await this.store.update(s => {
              const b = (s.expenseBatches || []).find(b => b.id === targetId);
              const m = b?.members.find(m => m.memberId === memberId);
              if (m) {
                m.status = 'paid';
                m.paidAmount = amount;
                m.paidAt = new Date().toISOString();
              }
              const allPaid = b?.members.every(mem => mem.status === 'paid');
              if (allPaid && b && !b.completedNotificationSent) {
                b.status = 'completed';
                b.completedAt = new Date().toISOString();
                b.completedNotificationSent = true;
                isAllCompleted = true;
              }
            });
          }
        } else {
          const service = state.services.find(s => s.id === targetId);
          const member = (state.members[targetId] || []).find(m => m.id === memberId);
          const now = new Date();
          const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

          if (service && member) {
            memberName = member.name;
            memberTag = member.telegramUsername || '';
            serviceName = service.name;
            amount = service.mode === 'per_member' && member.customAmount
              ? member.customAmount
              : (service.defaultAmountPerMember || Math.round(service.totalAmount / (state.members[targetId]?.length || 1)));

            await this.store.update(s => {
              let p = s.monthlyPayments.find(pay => pay.serviceId === targetId && pay.memberId === memberId && pay.month === currentMonth);
              if (!p) {
                s.monthlyPayments.push({
                  memberId: member.id,
                  serviceId: targetId,
                  month: currentMonth,
                  expectedAmount: amount,
                  paidAmount: amount,
                  status: 'paid',
                  transactionIds: [],
                  paidAt: new Date().toISOString()
                });
              } else {
                qrMsgId = p.qrMessageId;
                qrChatId = p.qrChatId;
                p.paidAmount = amount;
                p.status = 'paid';
                p.paidAt = new Date().toISOString();
              }
            });
          }
        }

        const tag = memberTag ? `@${memberTag}` : `*${memberName}*`;
        const approverTag = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Trưởng nhóm');

        // Cập nhật lại tin nhắn hiển thị (bỏ nút bấm)
        if (isGroupChat) {
          try {
            await ctx.editMessageText(
              `✅ *ĐÃ XÁC NHẬN THANH TOÁN THÀNH CÔNG*\n\n` +
              `👤 Thành viên: ${tag} (\`${memberName}\`)\n` +
              `📦 Dịch vụ: *${serviceName}*\n` +
              `💰 Số tiền: *${amount.toLocaleString('vi-VN')}đ*\n` +
              `👑 Người duyệt: *${approverTag}*\n` +
              `⏰ Lúc: ${new Date().toLocaleTimeString('vi-VN')} ${new Date().toLocaleDateString('vi-VN')}\n\n` +
              `🎉 _Hệ thống đã ghi nhận hoàn tất. Cảm ơn bạn!_ 🚀`,
              { parse_mode: 'Markdown' }
            );
          } catch (e) {}
        } else {
          try {
            await ctx.editMessageText(
              `✅ *BẠN ĐÃ XÁC NHẬN THÀNH CÔNG!*\n\n` +
              `👤 Thành viên: ${tag} (\`${memberName}\`)\n` +
              `💰 Số tiền: *${amount.toLocaleString('vi-VN')}đ*\n` +
              `📦 Dịch vụ: *${serviceName}*\n` +
              `⏰ Lúc: ${new Date().toLocaleTimeString('vi-VN')}\n\n` +
              `_Bot đã gửi thông báo xác nhận vào nhóm và cập nhật Dashboard._`,
              { parse_mode: 'Markdown' }
            );
          } catch (e) {}

          // Bắn tin nhắn xác nhận hoàn tất vào nhóm nếu duyệt từ DM
          if (groupObj) {
            const successMsg =
              `✅ *XÁC NHẬN THANH TOÁN THÀNH CÔNG*\n\n` +
              `Người duyệt (${collector.tag}) đã xác nhận: ${tag} đã nộp đủ *${amount.toLocaleString('vi-VN')}đ* cho *${serviceName}*!\n\n` +
              `🎉 _Hệ thống đã ghi nhận hoàn tất. Cảm ơn bạn!_ 🚀`;

            await this.sendPaymentSuccessNotification(groupObj.chatId, successMsg, groupObj.threadId);
          }
        }

        await ctx.answerCallbackQuery({ text: `✅ Đã duyệt thành công cho ${memberName}!` });

        // Xóa mã QR cũ trong nhóm nếu có
        if (qrMsgId && qrChatId) {
          this.deleteMessage(qrChatId, qrMsgId).catch(() => {});
        }

        if (isAllCompleted && groupObj) {
          const celebrationMsg =
            `🎉 *TẤT CẢ THÀNH VIÊN ĐÃ HOÀN TẤT ĐÓNG TIỀN!* 🎉\n\n` +
            `📦 Đợt thu: *${serviceName}*\n` +
            `💰 Trạng thái: *100% thành viên đã hoàn thành*\n\n` +
            `❤️ _Cảm ơn tất cả mọi người đã đóng tiền đầy đủ!_ 🚀`;
          await this.sendMessage(groupObj.chatId, celebrationMsg, groupObj.threadId);
        }
        return;
      }

      // =========================================================================
      // 4. TỪ CHỐI "CHƯA THẤY TIỀN" (REJECT) TRONG TIN NHẮN RIÊNG HOẶC NHÓM
      // =========================================================================
      if (data.startsWith('admin_reject_batch:') || data.startsWith('admin_reject_svc:')) {
        const state = await this.store.read();
        const isBatch = data.startsWith('admin_reject_batch:');
        const targetId = data.split(':')[1];
        const memberId = data.split(':')[2];

        const isGroupChat = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
        const fromId = String(ctx.from?.id);
        const fromUsername = (ctx.from?.username || '').toLowerCase().trim();

        const serviceObj = isBatch 
          ? state.services.find(s => s.id === (state.expenseBatches || []).find(b => b.id === targetId)?.serviceId)
          : state.services.find(s => s.id === targetId);
        const groupObj = isBatch
          ? state.groups.find(g => g.id === (state.expenseBatches || []).find(b => b.id === targetId)?.groupId || g.id === serviceObj?.groupId)
          : state.groups.find(g => g.id === serviceObj?.groupId);

        const collector = this.resolveCollector(serviceObj, groupObj, state);

        // Phân quyền nếu bấm trong nhóm chung
        if (isGroupChat) {
          const isMatchingUser = 
            (collector.chatId && fromId === collector.chatId) ||
            (collector.username && fromUsername === collector.username) ||
            (config.TELEGRAM_ADMIN_ID && fromId === config.TELEGRAM_ADMIN_ID);

          let isGroupAdmin = false;
          if (!isMatchingUser && ctx.chat?.id && ctx.from?.id) {
            try {
              const memberChatInfo = await ctx.getChatMember(ctx.from.id);
              if (memberChatInfo.status === 'creator' || memberChatInfo.status === 'administrator') {
                isGroupAdmin = true;
              }
            } catch (e) {}
          }

          if (!isMatchingUser && !isGroupAdmin) {
            const authorizedName = collector.tag || 'Trưởng nhóm / Quản trị viên';
            await ctx.answerCallbackQuery({
              text: `⚠️ Chỉ ${authorizedName} mới có quyền từ chối duyệt giao dịch này!`,
              show_alert: true
            });
            return;
          }
        }

        let memberName = '';
        let memberTag = '';
        let serviceName = '';
        let amount = 0;

        if (isBatch) {
          const batch = (state.expenseBatches || []).find(b => b.id === targetId);
          const memberItem = batch?.members.find(m => m.memberId === memberId);

          if (batch && memberItem) {
            memberName = memberItem.name;
            memberTag = memberItem.telegramUsername || '';
            serviceName = batch.title;
            amount = memberItem.amount;

            await this.store.update(s => {
              const b = (s.expenseBatches || []).find(b => b.id === targetId);
              const m = b?.members.find(m => m.memberId === memberId);
              if (m) m.status = 'unpaid';
            });
          }
        } else {
          const service = state.services.find(s => s.id === targetId);
          const member = (state.members[targetId] || []).find(m => m.id === memberId);
          const now = new Date();
          const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

          if (service && member) {
            memberName = member.name;
            memberTag = member.telegramUsername || '';
            serviceName = service.name;
            amount = service.mode === 'per_member' && member.customAmount
              ? member.customAmount
              : (service.defaultAmountPerMember || Math.round(service.totalAmount / (state.members[targetId]?.length || 1)));

            await this.store.update(s => {
              let p = s.monthlyPayments.find(pay => pay.serviceId === targetId && pay.memberId === memberId && pay.month === currentMonth);
              if (p) p.status = 'unpaid';
            });
          }
        }

        const tag = memberTag ? `@${memberTag}` : `*${memberName}*`;
        const rejecterTag = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Người duyệt');

        if (isGroupChat) {
          try {
            await ctx.editMessageText(
              `⚠️ *TỪ CHỐI XÁC NHẬN CHUYỂN KHOẢN*\n\n` +
              `👤 Thành viên: ${tag} (\`${memberName}\`)\n` +
              `📦 Dịch vụ: *${serviceName}*\n` +
              `💰 Số tiền: *${amount.toLocaleString('vi-VN')}đ*\n` +
              `👑 Người từ chối: *${rejecterTag}*\n\n` +
              `👉 ${tag} ơi, Người duyệt kiểm tra tài khoản nhưng *chưa thấy* khoản tiền này. Bạn vui lòng kiểm tra lại app ngân hàng hoặc gửi ảnh biên lai nhé!`,
              { parse_mode: 'Markdown' }
            );
          } catch (e) {}
        } else {
          try {
            await ctx.editMessageText(
              `❌ *BẠN ĐÃ TỪ CHỐI XÁC NHẬN*\n\n` +
              `👤 Thành viên: ${tag} (\`${memberName}\`)\n` +
              `💰 Số tiền: *${amount.toLocaleString('vi-VN')}đ*\n\n` +
              `_Bot đã thông báo cho thành viên để kiểm tra lại giao dịch._`,
              { parse_mode: 'Markdown' }
            );
          } catch (e) {}

          if (groupObj) {
            const rejectMsg =
              `⚠️ *THÔNG BÁO TỪ NGƯỜI DUYỆT (${collector.tag})*\n\n` +
              `${tag} ơi, Người duyệt kiểm tra tài khoản nhưng *chưa thấy* khoản chuyển *${amount.toLocaleString('vi-VN')}đ* cho *${serviceName}*.\n\n` +
              `👉 _Bạn vui lòng kiểm tra lại trạng thái chuyển khoản trên App ngân hàng hoặc gửi ảnh biên lai nhé!_`;

            await this.sendMessage(groupObj.chatId, rejectMsg, groupObj.threadId);
          }
        }

        await ctx.answerCallbackQuery({ text: `❌ Đã từ chối xác nhận cho ${memberName}!` });
        return;
      }

      await ctx.answerCallbackQuery();
    });
  }

  /**
   * Bắt đầu nhận tin nhắn qua Polling
   */
  public async start(): Promise<void> {
    if (!this.bot) {
      console.log('🤖 Telegram Bot đang chạy ở chế độ Mock (Chưa có BOT_TOKEN).');
      return;
    }

    if (this.isRunning) return;

    try {
      this.isRunning = true;
      this.bot.start({
        onStart: botInfo => {
          console.log(`🤖 Telegram Bot đã kết nối thành công: @${botInfo.username}`);
        }
      });
    } catch (error) {
      console.error('❌ Lỗi khởi động Telegram Bot polling:', error);
      this.isRunning = false;
    }
  }

  /**
   * Dừng bot an toàn
   */
  public async stop(): Promise<void> {
    if (this.bot && this.isRunning) {
      await this.bot.stop();
      this.isRunning = false;
      console.log('🛑 Telegram Bot đã dừng.');
    }
  }

  /**
   * Gửi thông báo nhắc tiền kèm danh sách nút bấm thành viên (Inline Keyboard)
   */
  public async sendMessageWithButtons(
    chatId: string,
    messageText: string,
    buttons: { text: string; callbackData: string }[],
    threadId?: number
  ): Promise<{ success: boolean; messageId?: number; error?: string }> {
    if (!this.bot) {
      console.log(`[MOCK TELEGRAM] Gửi tin nhắn kèm nút tới ${chatId}:\n${messageText}`);
      return { success: true, messageId: 999999 };
    }

    try {
      const keyboard = new InlineKeyboard();
      buttons.forEach((btn, idx) => {
        keyboard.text(btn.text, btn.callbackData);
        if (idx % 2 === 1 && idx < buttons.length - 1) {
          keyboard.row();
        }
      });

      const options: any = {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      };
      if (threadId) {
        options.message_thread_id = threadId;
      }

      try {
        const sent = await this.bot.api.sendMessage(chatId, messageText, options);
        return { success: true, messageId: sent.message_id };
      } catch (mdErr: any) {
        console.warn(`⚠️ Lỗi Markdown parse, đang fallback gửi text thường tới ${chatId}:`, mdErr?.message);
        delete options.parse_mode;
        const sent = await this.bot.api.sendMessage(chatId, messageText.replace(/[*_`]/g, ''), options);
        return { success: true, messageId: sent.message_id };
      }
    } catch (error: any) {
      console.error(`❌ Lỗi gửi tin nhắn kèm nút tới ${chatId}:`, error);
      return { success: false, error: error?.message || String(error) };
    }
  }

  /**
   * Gửi thông báo nhắc tiền (kèm mã QR nếu có)
   */
  public async sendReminder(
    chatId: string,
    messageText: string,
    qrImageUrl?: string,
    threadId?: number
  ): Promise<{ success: boolean; messageId?: number; error?: string }> {
    if (!this.bot) {
      console.log(`[MOCK TELEGRAM] Gửi thông báo tới ${chatId}:\n${messageText}\nQR: ${qrImageUrl || 'None'}`);
      return { success: true, messageId: 999999 };
    }

    try {
      const options: any = { parse_mode: 'Markdown' };
      if (threadId) {
        options.message_thread_id = threadId;
      }

      if (qrImageUrl) {
        try {
          const sent = await this.bot.api.sendPhoto(chatId, qrImageUrl, {
            caption: messageText,
            parse_mode: 'Markdown',
            ...(threadId ? { message_thread_id: threadId } : {})
          });
          return { success: true, messageId: sent.message_id };
        } catch (photoErr) {
          console.warn('⚠️ Không thể gửi ảnh QR trực tiếp, chuyển sang gửi tin nhắn văn bản kèm link:', photoErr);
          const fallbackText = `${messageText}\n\n🖼 [Bấm vào đây để xem mã VietQR](${qrImageUrl})`;
          const sent = await this.bot.api.sendMessage(chatId, fallbackText, options);
          return { success: true, messageId: sent.message_id };
        }
      } else {
        const sent = await this.bot.api.sendMessage(chatId, messageText, options);
        return { success: true, messageId: sent.message_id };
      }
    } catch (error: any) {
      console.error(`❌ Lỗi gửi tin nhắn Telegram tới ${chatId}:`, error);
      return { success: false, error: error?.message || String(error) };
    }
  }

  /**
   * Gửi thông báo xác nhận đã nhận tiền vào nhóm
   */
  public async sendPaymentSuccessNotification(
    chatId: string,
    messageText: string,
    threadId?: number
  ): Promise<boolean> {
    if (!this.bot) {
      console.log(`[MOCK TELEGRAM] Xác nhận thanh toán tới ${chatId}:\n${messageText}`);
      return true;
    }

    try {
      const options: any = { parse_mode: 'Markdown' };
      if (threadId) {
        options.message_thread_id = threadId;
      }
      await this.bot.api.sendMessage(chatId, messageText, options);
      return true;
    } catch (error) {
      console.error(`❌ Lỗi gửi thông báo thanh toán tới ${chatId}:`, error);
      return false;
    }
  }

  /**
   * Gửi tin nhắn thông thường / thông báo hoàn tất vào nhóm
   */
  public async sendMessage(
    chatId: string,
    messageText: string,
    threadId?: number
  ): Promise<boolean> {
    if (!this.bot) {
      console.log(`[MOCK TELEGRAM] Gửi tin nhắn tới ${chatId}:\n${messageText}`);
      return true;
    }

    try {
      const options: any = { parse_mode: 'Markdown' };
      if (threadId) {
        options.message_thread_id = threadId;
      }
      await this.bot.api.sendMessage(chatId, messageText, options);
      return true;
    } catch (error) {
      console.error(`❌ Lỗi gửi tin nhắn tới ${chatId}:`, error);
      return false;
    }
  }

  /**
   * Gửi cảnh báo giao dịch chưa khớp tới Admin / Nhóm cảnh báo
   */
  public async sendAdminAlert(messageText: string, customAlertChatId?: string): Promise<boolean> {
    const targetChatId = customAlertChatId || config.TELEGRAM_ADMIN_ID;
    if (!targetChatId) {
      console.warn('⚠️ Chưa cấu hình TELEGRAM_ADMIN_ID hoặc Alert Chat ID để gửi cảnh báo giao dịch.');
      return false;
    }

    if (!this.bot) {
      console.log(`[MOCK TELEGRAM] Cảnh báo Admin tới ${targetChatId}:\n${messageText}`);
      return true;
    }

    try {
      await this.bot.api.sendMessage(targetChatId, messageText, { parse_mode: 'Markdown' });
      return true;
    } catch (error) {
      console.error(`❌ Lỗi gửi cảnh báo tới Admin (${targetChatId}):`, error);
      return false;
    }
  }

  /**
   * Xóa một tin nhắn (ví dụ: ảnh QR của người vừa chuyển khoản xong để nhóm gọn gàng)
   */
  public async deleteMessage(chatId: string, messageId: number): Promise<boolean> {
    if (!this.bot) return true;
    try {
      await this.bot.api.deleteMessage(chatId, messageId);
      return true;
    } catch (error) {
      return false;
    }
  }
}
