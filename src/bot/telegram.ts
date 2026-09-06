import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config.js';
import { JsonStore } from '../store/json-store.js';
import { SepayProvider } from '../providers/sepay.provider.js';
import { Service, Group } from '../types.js';

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

  private setupCommands(): void {
    if (!this.bot) return;

    // Lệnh /start
    this.bot.command('start', async ctx => {
      const chatId = ctx.chat.id;
      const userId = String(ctx.from?.id);
      const username = ctx.from?.username;
      const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      
      // Nếu là chat riêng, tự động liên kết telegramUserId với thành viên tương ứng
      if (!isGroup && userId) {
        await this.store.update(state => {
          for (const serviceId of Object.keys(state.members)) {
            for (const member of state.members[serviceId]) {
              if (username && member.telegramUsername && member.telegramUsername.toLowerCase() === username.toLowerCase()) {
                member.telegramUserId = userId;
              }
            }
          }
          if (state.users && state.users.length > 0) {
            const matchedUser = username 
              ? state.users.find(u => u.username.toLowerCase() === username.toLowerCase())
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
      msg += `• \`/chatid\` - Lấy Chat ID & Topic ID của nhóm\n`;
      msg += `• \`/danop @username\` - Đánh dấu thành viên đã nộp tiền nhanh\n`;
      msg += `• \`/status\` - Xem trạng thái đóng tiền dịch vụ tháng này\n`;
      msg += `• \`/help\` - Hướng dẫn chuyển khoản đúng cú pháp\n`;

      await ctx.reply(msg, { parse_mode: 'Markdown' });
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
      msg += `1️⃣ Khi có thông báo nhắc tiền, bấm vào tên bạn để lấy mã *VietQR cá nhân hóa*.\n`;
      msg += `2️⃣ Quét mã QR bằng App ngân hàng để chuyển khoản đúng cú pháp.\n`;
      msg += `3️⃣ Chuyển khoản xong, bấm nút *[ 📩 Tôi Đã Chuyển Tiền ]* dưới ảnh QR để báo cho Trưởng nhóm.\n`;
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

            if (userId) {
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

            if (userId) {
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
          const caption =
            `👤 *MÃ THANH TOÁN VIETQR: ${memberName.toUpperCase()}*\n` +
            (memberTag ? `🏷️ Tag: @${memberTag}\n` : '') +
            `📦 Dịch vụ: *${serviceName}*\n` +
            `💰 Số tiền: *${amount.toLocaleString('vi-VN')}đ*\n` +
            `📝 Nội dung CK: \`${fullTransferCode}\`\n` +
            `🏦 Ngân hàng: *${bankInfo.bankCode}*\n` +
            `💳 STK: \`${bankInfo.accountNumber}\`\n` +
            `👤 Chủ TK: *${bankInfo.accountName}*\n\n` +
            (isSepayMode
              ? `⚡ _Mã QR đã có sẵn số tiền & nội dung chính xác. Sau khi chuyển khoản, SePay sẽ tự động đối soát và xác nhận trong 5-30 giây!_`
              : `⚡ _Quét mã bằng App ngân hàng để thanh toán, sau khi CK xong bấm nút bên dưới để báo Trưởng nhóm duyệt:_`);

          // Gắn nút "Tôi Đã Chuyển Tiền" dưới ảnh QR
          const selfPayCallback = data.startsWith('pay_batch:')
            ? `self_pay_batch:${data.split(':')[1]}:${data.split(':')[2]}`
            : `self_pay_svc:${data.split(':')[1]}:${data.split(':')[2]}`;

          const replyMarkup = new InlineKeyboard().text('📩 Tôi Đã Chuyển Tiền Xong', selfPayCallback);


          let sentMessageId: number | undefined;
          const chatId = String(ctx.chat?.id || ctx.callbackQuery.message?.chat.id || '');

          try {
            const sent = await ctx.replyWithPhoto(qrUrl, {
              caption,
              parse_mode: 'Markdown',
              reply_to_message_id: ctx.callbackQuery.message?.message_id,
              reply_markup: replyMarkup
            });
            sentMessageId = sent.message_id;
          } catch (photoErr) {
            const sent = await ctx.reply(`${caption}\n\n🖼 [Bấm vào đây để xem mã VietQR](${qrUrl})`, {
              parse_mode: 'Markdown',
              reply_to_message_id: ctx.callbackQuery.message?.message_id,
              reply_markup: replyMarkup
            });
            sentMessageId = sent.message_id;
          }

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

        // Xác định Chat ID riêng của Người Thu Tiền / Trưởng nhóm (Ưu tiên theo Dịch vụ -> Nhóm -> Admin)
        const adminChatId = serviceObj?.collectorChatId || groupObj?.alertChatId || ownerUser?.telegramChatId || config.TELEGRAM_ADMIN_ID;
        const groupChatId = groupObj?.chatId || ctx.chat?.id;

        // Lấy thông tin username của Bot
        let botUsername = 'thongbaodongtien_bot';
        try {
          const botInfo = await this.bot?.api.getMe();
          if (botInfo?.username) botUsername = botInfo.username;
        } catch {}

        if (adminChatId) {
          const verifyText =
            `🔔 *YÊU CẦU XÁC NHẬN CHUYỂN KHOẢN (DUYỆT TIỀN)*\n\n` +
            `👥 *Nhóm:* ${groupTitle}\n` +
            `📦 *Dịch vụ / Đợt thu:* *${serviceName}*\n` +
            `👤 *Thành viên:* ${tag} (\`${memberName}\`)\n` +
            `💰 *Số tiền:* *${amount.toLocaleString('vi-VN')}đ*\n` +
            `📝 *Nội dung CK:* \`${fullTransferCode}\`\n` +
            `⏰ *Thời gian:* ${new Date().toLocaleTimeString('vi-VN')} ${new Date().toLocaleDateString('vi-VN')}\n\n` +
            `👇 *Vui lòng kiểm tra App ngân hàng xem tiền đã vào chưa và bấm duyệt:*`;

          const approveData = isBatch ? `admin_approve_batch:${targetId}:${memberId}` : `admin_approve_svc:${targetId}:${memberId}`;
          const rejectData = isBatch ? `admin_reject_batch:${targetId}:${memberId}` : `admin_reject_svc:${targetId}:${memberId}`;

          const verifyKeyboard = new InlineKeyboard()
            .text('✅ Đã Nhận Tiền', approveData)
            .text('❌ Chưa Thấy Tiền', rejectData);

          let dmSuccess = false;
          try {
            await this.bot?.api.sendMessage(adminChatId, verifyText, {
              parse_mode: 'Markdown',
              reply_markup: verifyKeyboard
            });
            dmSuccess = true;
          } catch (sendErr: any) {
            console.error(`❌ Lỗi gửi tin nhắn riêng tới Trưởng nhóm (${adminChatId}):`, sendErr?.message || sendErr);
          }

          if (dmSuccess) {
            await ctx.answerCallbackQuery({
              text: '🔔 Đã xóa ảnh QR & gửi tin nhắn riêng cho Trưởng nhóm duyệt!'
            });

            // Bắn thông báo ngắn vào nhóm để mọi người cùng biết
            if (groupChatId) {
              await this.sendMessage(
                String(groupChatId),
                `⏳ ${tag} vừa báo đã chuyển khoản *${amount.toLocaleString('vi-VN')}đ* cho *${serviceName}*! Bot đã gửi tin nhắn riêng cho Trưởng nhóm để xác nhận.`,
                groupObj?.threadId
              );
            }
          } else {
            await ctx.answerCallbackQuery({
              text: '🔔 Đã xóa ảnh QR! (Trưởng nhóm chưa bấm /start với Bot để nhận tin nhắn riêng).'
            });

            // Bắn thông báo hướng dẫn Trưởng nhóm mở chat riêng với Bot
            if (groupChatId) {
              await this.sendMessage(
                String(groupChatId),
                `⚠️ *THÔNG BÁO DUYỆT TIỀN:*\n` +
                `Thành viên ${tag} vừa báo đã chuyển khoản *${amount.toLocaleString('vi-VN')}đ* cho *${serviceName}* (Nội dung: \`${fullTransferCode}\`).\n\n` +
                `👉 *Trưởng nhóm lưu ý:* Bot chưa thể gửi tin nhắn duyệt riêng do bạn chưa bấm Start với Bot. Vui lòng mở chat với @${botUsername} và gửi lệnh */start* để kích hoạt nhận tin nhắn duyệt tiền!`,
                groupObj?.threadId
              );
            }
          }
        } else {
          await ctx.answerCallbackQuery({
            text: '🔔 Đã xóa ảnh QR! (Nhóm chưa cài đặt Chat ID riêng của Chủ Thu).'
          });

          // Bắn thông báo hướng dẫn cài đặt Chủ Thu
          if (groupChatId) {
            await this.sendMessage(
              String(groupChatId),
              `⚠️ *THÔNG BÁO DUYỆT TIỀN:*\n` +
              `Thành viên ${tag} vừa báo đã chuyển khoản *${amount.toLocaleString('vi-VN')}đ* cho *${serviceName}* (Nội dung: \`${fullTransferCode}\`).\n\n` +
              `👉 *Nhóm chưa cài đặt Chat ID của Chủ Thu (Trưởng nhóm).* Trưởng nhóm vui lòng vào Web Dashboard > Nhóm > Sửa Nhóm để điền Chat ID, hoặc chat riêng với @${botUsername} và gửi */start* để Bot tự động liên kết!`,
              groupObj?.threadId
            );
          }
        }
        return;
      }


      // =========================================================================
      // 3. TRƯỞNG NHÓM BẤM "ĐÃ NHẬN TIỀN" (APPROVE) TRONG TIN NHẮN RIÊNG
      // =========================================================================
      if (data.startsWith('admin_approve_batch:') || data.startsWith('admin_approve_svc:')) {
        const state = await this.store.read();
        const isBatch = data.startsWith('admin_approve_batch:');
        const targetId = data.split(':')[1];
        const memberId = data.split(':')[2];

        let memberName = '';
        let memberTag = '';
        let serviceName = '';
        let amount = 0;
        let groupObj: Group | undefined;
        let qrMsgId: number | undefined;
        let qrChatId: string | undefined;
        let isAllCompleted = false;

        if (isBatch) {
          const batch = (state.expenseBatches || []).find(b => b.id === targetId);
          const service = state.services.find(s => s.id === batch?.serviceId);
          groupObj = state.groups.find(g => g.id === batch?.groupId || g.id === service?.groupId);
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
          groupObj = state.groups.find(g => g.id === service?.groupId);
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

        // Cập nhật lại tin nhắn riêng của Trưởng nhóm (bỏ nút bấm)
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

        await ctx.answerCallbackQuery({ text: `✅ Đã duyệt thành công cho ${memberName}!` });

        // Xóa mã QR cũ trong nhóm nếu có
        if (qrMsgId && qrChatId) {
          this.deleteMessage(qrChatId, qrMsgId).catch(() => {});
        }

        // Bắn tin nhắn xác nhận hoàn tất vào nhóm
        if (groupObj) {
          const successMsg =
            `✅ *XÁC NHẬN THANH TOÁN THÀNH CÔNG*\n\n` +
            `Trưởng nhóm đã xác nhận: ${tag} đã nộp đủ *${amount.toLocaleString('vi-VN')}đ* cho *${serviceName}*!\n\n` +
            `🎉 _Hệ thống đã ghi nhận hoàn tất. Cảm ơn bạn!_ 🚀`;

          await this.sendPaymentSuccessNotification(groupObj.chatId, successMsg, groupObj.threadId);

          if (isAllCompleted) {
            const celebrationMsg =
              `🎉 *TẤT CẢ THÀNH VIÊN ĐÃ HOÀN TẤT ĐÓNG TIỀN!* 🎉\n\n` +
              `📦 Đợt thu: *${serviceName}*\n` +
              `💰 Trạng thái: *100% thành viên đã hoàn thành*\n\n` +
              `❤️ _Cảm ơn tất cả mọi người đã đóng tiền đầy đủ!_ 🚀`;
            await this.sendMessage(groupObj.chatId, celebrationMsg, groupObj.threadId);
          }
        }
        return;
      }

      // =========================================================================
      // 4. TRƯỞNG NHÓM BẤM "CHƯA THẤY TIỀN" (REJECT) TRONG TIN NHẮN RIÊNG
      // =========================================================================
      if (data.startsWith('admin_reject_batch:') || data.startsWith('admin_reject_svc:')) {
        const state = await this.store.read();
        const isBatch = data.startsWith('admin_reject_batch:');
        const targetId = data.split(':')[1];
        const memberId = data.split(':')[2];

        let memberName = '';
        let memberTag = '';
        let serviceName = '';
        let amount = 0;
        let groupObj: Group | undefined;

        if (isBatch) {
          const batch = (state.expenseBatches || []).find(b => b.id === targetId);
          const service = state.services.find(s => s.id === batch?.serviceId);
          groupObj = state.groups.find(g => g.id === batch?.groupId || g.id === service?.groupId);
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
          groupObj = state.groups.find(g => g.id === service?.groupId);
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

        // Cập nhật lại tin nhắn riêng của Trưởng nhóm (bỏ nút bấm)
        try {
          await ctx.editMessageText(
            `❌ *BẠN ĐÃ TỪ CHỐI XÁC NHẬN*\n\n` +
            `👤 Thành viên: ${tag} (\`${memberName}\`)\n` +
            `💰 Số tiền: *${amount.toLocaleString('vi-VN')}đ*\n\n` +
            `_Bot đã thông báo cho thành viên để kiểm tra lại giao dịch._`,
            { parse_mode: 'Markdown' }
          );
        } catch (e) {}

        await ctx.answerCallbackQuery({ text: `❌ Đã từ chối xác nhận cho ${memberName}!` });

        // Bắn thông báo nhắc nhở vào nhóm
        if (groupObj) {
          const rejectMsg =
            `⚠️ *THÔNG BÁO TỪ TRƯỞNG NHÓM*\n\n` +
            `${tag} ơi, Trưởng nhóm kiểm tra tài khoản nhưng *chưa thấy* khoản chuyển *${amount.toLocaleString('vi-VN')}đ* cho *${serviceName}*.\n\n` +
            `👉 _Bạn vui lòng kiểm tra lại trạng thái chuyển khoản trên App ngân hàng hoặc gửi ảnh biên lai nhé!_`;

          await this.sendMessage(groupObj.chatId, rejectMsg, groupObj.threadId);
        }
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

      const sent = await this.bot.api.sendMessage(chatId, messageText, options);
      return { success: true, messageId: sent.message_id };
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
