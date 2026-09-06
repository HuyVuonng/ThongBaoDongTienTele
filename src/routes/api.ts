import { Router, Request, Response } from 'express';
import { JsonStore } from '../store/json-store.js';
import { ReminderService } from '../services/reminder.service.js';
import { ReconciliationService } from '../services/reconciliation.service.js';
import { TelegramBotService } from '../bot/telegram.js';
import { SepayProvider } from '../providers/sepay.provider.js';
import { SepaySyncService } from '../services/sepay-sync.service.js';
import bcrypt from 'bcryptjs';
import { requireAuth, requireAdmin } from './auth.js';
import { GroupSchema, ServiceSchema, MemberSchema, Group, Service, Member, Transaction } from '../types.js';
import { config } from '../config.js';

export const apiRouter = Router();

const store = JsonStore.getInstance();
const reminderService = ReminderService.getInstance();
const reconciliationService = ReconciliationService.getInstance();
const telegramService = TelegramBotService.getInstance();
const sepayProvider = new SepayProvider();
const sepaySyncService = SepaySyncService.getInstance();

// Áp dụng xác thực admin cho toàn bộ /api ngoại trừ các public endpoint nếu có
apiRouter.use(requireAuth);

// Helper lấy ID người dùng hiện tại từ session
function getAuthUserId(req: Request): string {
  return req.session?.userId || 'usr_admin';
}

function isUserAdmin(req: Request): boolean {
  return req.session?.role === 'admin';
}

// ==========================================
// 1. TỔNG QUAN HỆ THỐNG & DASHBOARD STATS
// ==========================================
apiRouter.get('/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthUserId(req);
    const admin = isUserAdmin(req);
    const state = await store.read();
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const displayMonth = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    // Lọc dịch vụ và nhóm thuộc về người dùng hiện tại
    const userServices = state.services.filter(s => s.userId === userId || (!s.userId && admin));
    const userGroups = state.groups.filter(g => g.userId === userId || (!g.userId && admin));
    const userServiceIds = userServices.map(s => s.id);

    // 1. Tính toán thống kê đóng tiền tháng này
    let totalExpected = 0;
    let totalCollected = 0;
    let totalActiveMembers = 0;
    let totalPaidCount = 0;
    let totalUnpaidCount = 0;

    const activeServices = userServices.filter(s => s.active);

    for (const svc of activeServices) {
      const members: Member[] = (state.members[svc.id] || []).filter(m => m.active);
      totalActiveMembers += members.length;

      for (const m of members) {
        const payment = state.monthlyPayments.find(
          p => p.serviceId === svc.id && p.memberId === m.id && p.month === currentMonth
        );

        let expected = 0;
        if (svc.scheduleType === 'on_demand') {
          expected = payment ? payment.expectedAmount : 0;
        } else {
          expected = svc.mode === 'per_member' && m.customAmount
            ? m.customAmount
            : (svc.defaultAmountPerMember || Math.round((svc.totalAmount || 0) / (members.length || 1)));
        }

        if (expected > 0) {
          totalExpected += expected;
        }

        if (payment && payment.status === 'paid') {
          totalCollected += payment.paidAmount || expected;
          totalPaidCount++;
        } else if (expected > 0) {
          totalUnpaidCount++;
          if (payment && payment.paidAmount > 0) {
            totalCollected += payment.paidAmount;
          }
        }
      }
    }

    const progressPercentage = totalExpected > 0 ? Math.min(100, Math.round((totalCollected / totalExpected) * 100)) : 0;

    // 2. Giao dịch chưa khớp gần đây
    const unmatchedTransactions = state.transactions
      .filter(t => !t.matched && (t.userId === userId || (!t.userId && admin) || userServiceIds.includes(t.serviceId || '')))
      .slice(0, 5);

    // 3. Lịch nhắc sắp tới trong tháng (Chỉ áp dụng cho gói định kỳ)
    const upcomingReminders = activeServices
      .filter(s => s.scheduleType !== 'on_demand')
      .map(s => {
        const group = userGroups.find(g => g.id === s.groupId) || state.groups.find(g => g.id === s.groupId);
        const receiptKey = `${s.groupId}:${s.id}:${currentMonth}`;
        const isSent = state.reminderReceipts.some(r => r.key === receiptKey && r.status === 'success');
        return {
          serviceId: s.id,
          serviceName: s.name,
          groupTitle: group?.title || 'Chưa gán nhóm',
          reminderDay: s.reminderDay || 1,
          reminderTime: s.reminderTime || '08:00',
          isSent,
          totalAmount: s.totalAmount || 0
        };
      })
      .sort((a, b) => (a.reminderDay || 0) - (b.reminderDay || 0));

    res.json({
      success: true,
      currentMonth: displayMonth,
      monthKey: currentMonth,
      stats: {
        totalGroups: userGroups.length,
        totalServices: userServices.length,
        activeServicesCount: activeServices.length,
        totalActiveMembers,
        totalExpected,
        totalCollected,
        progressPercentage,
        totalPaidCount,
        totalUnpaidCount
      },
      system: {
        botConfigured: Boolean(config.BOT_TOKEN),
        adminConfigured: Boolean(config.TELEGRAM_ADMIN_ID),
        sepaySecretConfigured: Boolean(config.SEPAY_WEBHOOK_SECRET),
        dataPath: config.DATA_PATH,
        nodeEnv: config.NODE_ENV
      },
      upcomingReminders,
      unmatchedTransactions
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 2. QUẢN LÝ NHÓM TELEGRAM (GROUPS)
// ==========================================
apiRouter.get('/groups', async (req: Request, res: Response): Promise<void> => {
  const userId = getAuthUserId(req);
  const admin = isUserAdmin(req);
  const state = await store.read();
  const userGroups = state.groups.filter(g => g.userId === userId || (!g.userId && admin));
  res.json({ success: true, groups: userGroups });
});

apiRouter.post('/groups', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthUserId(req);
    const validated = GroupSchema.parse(req.body);
    const newGroup: Group = {
      id: `grp_${Date.now()}`,
      userId,
      ...validated,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await store.update(s => {
      s.groups.push(newGroup);
    });

    res.json({ success: true, group: newGroup });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message || 'Dữ liệu nhóm không hợp lệ' });
  }
});

apiRouter.put('/groups/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthUserId(req);
    const admin = isUserAdmin(req);
    const id = req.params.id as string;
    const validated = GroupSchema.parse(req.body);

    let updated: Group | undefined;
    await store.update(s => {
      const idx = s.groups.findIndex(g => g.id === id);
      if (idx === -1) throw new Error('Không tìm thấy nhóm');
      if (s.groups[idx].userId && s.groups[idx].userId !== userId && !admin) {
        throw new Error('Bạn không có quyền sửa nhóm này');
      }

      s.groups[idx] = {
        ...s.groups[idx],
        ...validated,
        userId: s.groups[idx].userId || userId,
        updatedAt: new Date().toISOString()
      };
      updated = s.groups[idx];
    });

    res.json({ success: true, group: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

apiRouter.delete('/groups/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthUserId(req);
    const admin = isUserAdmin(req);
    const id = req.params.id as string;
    await store.update(s => {
      const target = s.groups.find(g => g.id === id);
      if (target && target.userId && target.userId !== userId && !admin) {
        throw new Error('Bạn không có quyền xóa nhóm này');
      }

      s.groups = s.groups.filter(g => g.id !== id);
      const servicesToDelete = s.services.filter(svc => svc.groupId === id).map(svc => svc.id);
      s.services = s.services.filter(svc => svc.groupId !== id);
      for (const svcId of servicesToDelete) {
        delete s.members[svcId];
      }
    });
    res.json({ success: true, message: 'Đã xóa nhóm thành công' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ==========================================
// 3. QUẢN LÝ DỊCH VỤ (SERVICES)
// ==========================================
apiRouter.get('/services', async (req: Request, res: Response): Promise<void> => {
  const userId = getAuthUserId(req);
  const admin = isUserAdmin(req);
  const { groupId } = req.query;
  const state = await store.read();
  let services = state.services.filter(s => s.userId === userId || (!s.userId && admin));
  if (typeof groupId === 'string' && groupId) {
    services = services.filter(s => s.groupId === groupId);
  }
  res.json({ success: true, services });
});

apiRouter.post('/services', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthUserId(req);
    const validated = ServiceSchema.parse(req.body);
    const newService: Service = {
      id: `svc_${Date.now()}`,
      userId,
      ...validated,
      mode: validated.mode || 'shared',
      totalAmount: validated.totalAmount || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await store.update(s => {
      s.services.push(newService);
      if (!s.members[newService.id]) {
        s.members[newService.id] = [];
      }
    });

    res.json({ success: true, service: newService });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message || 'Dữ liệu dịch vụ không hợp lệ' });
  }
});

apiRouter.put('/services/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthUserId(req);
    const admin = isUserAdmin(req);
    const id = req.params.id as string;
    const validated = ServiceSchema.parse(req.body);

    let updated: Service | undefined;
    await store.update(s => {
      const idx = s.services.findIndex(svc => svc.id === id);
      if (idx === -1) throw new Error('Không tìm thấy dịch vụ');
      if (s.services[idx].userId && s.services[idx].userId !== userId && !admin) {
        throw new Error('Bạn không có quyền sửa dịch vụ này');
      }

      s.services[idx] = {
        ...s.services[idx],
        ...validated,
        userId: s.services[idx].userId || userId,
        mode: validated.mode || s.services[idx].mode || 'shared',
        totalAmount: validated.totalAmount !== undefined ? validated.totalAmount : s.services[idx].totalAmount,
        updatedAt: new Date().toISOString()
      };

      // Tự động xóa biên nhận tháng hiện tại nếu user chỉnh sửa giờ/ngày nhắc để kích hoạt theo lịch mới
      if (validated.reminderTime || validated.reminderDay) {
        const now = new Date();
        const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        s.reminderReceipts = s.reminderReceipts.filter(r => !(r.serviceId === id && r.month === curMonth));
      }

      updated = s.services[idx];
    });

    res.json({ success: true, service: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

apiRouter.delete('/services/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthUserId(req);
    const admin = isUserAdmin(req);
    const id = req.params.id as string;
    await store.update(s => {
      const target = s.services.find(svc => svc.id === id);
      if (target && target.userId && target.userId !== userId && !admin) {
        throw new Error('Bạn không có quyền xóa dịch vụ này');
      }

      s.services = s.services.filter(svc => svc.id !== id);
      delete s.members[id];
    });
    res.json({ success: true, message: 'Đã xóa dịch vụ thành công' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Xem trước tin nhắn & QR Code
apiRouter.post('/services/preview', async (req: Request, res: Response): Promise<void> => {
  try {
    const { service, groupId } = req.body;
    const state = await store.read();
    const group = state.groups.find(g => g.id === groupId) || {
      id: 'demo-group',
      chatId: '-100000000',
      title: 'Nhóm Mẫu',
      active: true,
      createdAt: '',
      updatedAt: ''
    };

    const serviceId = (service.id || '') as string;
    const members: Member[] = (serviceId && state.members[serviceId]) ? state.members[serviceId] : [
      { id: '1', name: 'Nguyễn Văn A', transferCode: `${service.transferPrefix || 'NET'}-A`, active: true, createdAt: '' },
      { id: '2', name: 'Trần Thị B', transferCode: `${service.transferPrefix || 'NET'}-B`, active: true, createdAt: '' }
    ];

    const now = new Date();
    const displayMonth = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const previewResult = reminderService.renderMessageTemplate(service, group, members, displayMonth);

    res.json({ success: true, ...previewResult });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Gửi thử tin nhắn nhắc vào nhóm Telegram (Live Test)
apiRouter.post('/services/:id/test-remind', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const result = await reminderService.sendTestReminder(id);
    res.json({ success: result.success, messageId: result.messageId, error: result.error, preview: result.preview, qrUrl: result.qrUrl });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Tạo và gửi đợt thu tiền phát sinh (Không định kỳ / Tùy biến số tiền từng người)
apiRouter.post('/services/:id/dispatch-batch', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { title, memberAmounts, note } = req.body;

    if (!title || !Array.isArray(memberAmounts)) {
      res.status(400).json({ success: false, error: 'Vui lòng nhập tên đợt thu và danh sách số tiền của từng thành viên' });
      return;
    }

    const result = await reminderService.sendCustomBatchReminder(id, title, memberAmounts, note);
    res.json({ ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ==========================================
// 4. QUẢN LÝ THÀNH VIÊN (MEMBERS)
// ==========================================
apiRouter.get('/services/:serviceId/members', async (req: Request, res: Response): Promise<void> => {
  const serviceId = req.params.serviceId as string;
  const { batchId } = req.query;
  const state = await store.read();
  const baseMembers: Member[] = state.members[serviceId] || [];
  const batches = (state.expenseBatches || []).filter(b => b.serviceId === serviceId);

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Nếu người dùng chọn xem 1 đợt cụ thể
  if (batchId && typeof batchId === 'string' && batchId !== 'base') {
    const selectedBatch = batches.find(b => b.id === batchId);
    if (selectedBatch) {
      const enrichedBatchMembers = selectedBatch.members.map(bm => {
        const originalMember = baseMembers.find(m => m.id === bm.memberId);
        return {
          id: bm.memberId,
          name: bm.name,
          transferCode: bm.transferCode,
          telegramUsername: bm.telegramUsername,
          telegramUserId: originalMember?.telegramUserId,
          customAmount: bm.amount,
          active: originalMember?.active ?? true,
          createdAt: originalMember?.createdAt || selectedBatch.sentAt,
          paymentStatus: bm.status,
          paidAmount: bm.paidAmount || (bm.status === 'paid' ? bm.amount : 0),
          paidAt: bm.paidAt,
          transactionId: bm.transactionId,
          batchId: selectedBatch.id
        };
      });

      const totalBatchMembers = selectedBatch.members.length;
      const paidMembersCount = selectedBatch.members.filter(m => m.status === 'paid').length;
      const collectedAmount = selectedBatch.members.reduce((sum, m) => sum + (m.status === 'paid' ? m.amount : (m.paidAmount || 0)), 0);

      res.json({
        success: true,
        members: enrichedBatchMembers,
        batch: {
          id: selectedBatch.id,
          title: selectedBatch.title,
          batchType: selectedBatch.batchType || 'on_demand',
          month: selectedBatch.month,
          totalAmount: selectedBatch.totalAmount,
          collectedAmount,
          status: selectedBatch.status,
          completedAt: selectedBatch.completedAt,
          sentAt: selectedBatch.sentAt,
          totalMembers: totalBatchMembers,
          paidMembersCount,
          progress: totalBatchMembers > 0 ? Math.round((paidMembersCount / totalBatchMembers) * 100) : 0
        },
        batches: batches.map(b => ({
          id: b.id,
          title: b.title,
          batchType: b.batchType || 'on_demand',
          month: b.month,
          totalAmount: b.totalAmount,
          sentAt: b.sentAt,
          status: b.status,
          totalMembers: b.members.length,
          paidMembersCount: b.members.filter(m => m.status === 'paid').length
        }))
      });
      return;
    }
  }

  // Danh sách gốc (Base directory)
  const enrichedMembers = baseMembers.map((m: Member) => {
    const payment = state.monthlyPayments.find(
      p => p.serviceId === serviceId && p.memberId === m.id && p.month === currentMonth
    );
    return {
      ...m,
      paymentStatus: payment?.status || 'unpaid',
      paidAmount: payment?.paidAmount || 0,
      paidAt: payment?.paidAt
    };
  });

  res.json({
    success: true,
    members: enrichedMembers,
    batch: null,
    batches: batches.map(b => ({
      id: b.id,
      title: b.title,
      batchType: b.batchType || 'on_demand',
      month: b.month,
      totalAmount: b.totalAmount,
      sentAt: b.sentAt,
      status: b.status,
      totalMembers: b.members.length,
      paidMembersCount: b.members.filter(m => m.status === 'paid').length
    }))
  });
});

// Lấy danh sách các đợt thu của dịch vụ
apiRouter.get('/services/:serviceId/batches', async (req: Request, res: Response): Promise<void> => {
  const serviceId = req.params.serviceId as string;
  const state = await store.read();
  const batches = (state.expenseBatches || [])
    .filter(b => b.serviceId === serviceId)
    .map(b => {
      const totalMembers = b.members.length;
      const paidMembersCount = b.members.filter(m => m.status === 'paid').length;
      const collectedAmount = b.members.reduce((sum, m) => sum + (m.status === 'paid' ? m.amount : (m.paidAmount || 0)), 0);
      return {
        id: b.id,
        serviceId: b.serviceId,
        groupId: b.groupId,
        title: b.title,
        batchType: b.batchType || 'on_demand',
        month: b.month,
        totalAmount: b.totalAmount,
        collectedAmount,
        sentAt: b.sentAt,
        status: b.status,
        completedAt: b.completedAt,
        note: b.note,
        totalMembers,
        paidMembersCount,
        progress: totalMembers > 0 ? Math.round((paidMembersCount / totalMembers) * 100) : 0,
        members: b.members
      };
    });

  res.json({ success: true, batches });
});

// Lấy chi tiết 1 đợt thu
apiRouter.get('/services/:serviceId/batches/:batchId', async (req: Request, res: Response): Promise<void> => {
  const { serviceId, batchId } = req.params;
  const state = await store.read();
  const batch = (state.expenseBatches || []).find(b => b.serviceId === serviceId && b.id === batchId);
  if (!batch) {
    res.status(404).json({ success: false, error: 'Đợt thu không tồn tại' });
    return;
  }
  res.json({ success: true, batch });
});

// Chuyển đổi trạng thái đóng tiền của thành viên trong một đợt cụ thể
apiRouter.post('/services/:serviceId/batches/:batchId/members/:memberId/toggle-paid', async (req: Request, res: Response): Promise<void> => {
  try {
    const { serviceId, batchId, memberId } = req.params;
    let newStatus: string = 'paid';
    let celebrationPayload: { group: Group; batchTitle: string; totalAmount: number; count: number } | null = null;

    await store.update(s => {
      if (!s.expenseBatches) s.expenseBatches = [];
      const batch = s.expenseBatches.find(b => b.serviceId === serviceId && b.id === batchId);
      if (!batch) throw new Error('Đợt thu không tồn tại');

      const memItem = batch.members.find(m => m.memberId === memberId);
      if (!memItem) throw new Error('Thành viên không nằm trong đợt thu này');

      const service = s.services.find(svc => svc.id === serviceId);
      const group = s.groups.find(g => g.id === service?.groupId);

      if (memItem.status === 'paid') {
        memItem.status = 'unpaid';
        memItem.paidAmount = 0;
        memItem.paidAt = undefined;
        batch.status = 'active';
        batch.completedNotificationSent = false;
        batch.completedAt = undefined;
        newStatus = 'unpaid';
      } else {
        memItem.status = 'paid';
        memItem.paidAmount = memItem.amount;
        memItem.paidAt = new Date().toISOString();
        newStatus = 'paid';

        // Xóa tin nhắn QR riêng của thành viên nếu có
        if (memItem.qrMessageId && memItem.qrChatId) {
          telegramService.deleteMessage(memItem.qrChatId, memItem.qrMessageId).catch(() => {});
          memItem.qrMessageId = undefined;
        }

        // Kiểm tra xem tất cả đã đóng đủ chưa
        const isAllPaid = batch.members.length > 0 && batch.members.every(m => m.status === 'paid');
        if (isAllPaid && !batch.completedNotificationSent) {
          batch.status = 'completed';
          batch.completedAt = new Date().toISOString();
          batch.completedNotificationSent = true;

          if (group) {
            celebrationPayload = {
              group,
              batchTitle: batch.title,
              totalAmount: batch.totalAmount,
              count: batch.members.length
            };
          }
        }
      }
    });

    // Nếu kích hoạt hoàn tất 100%, gửi thông báo Telegram vào nhóm
    if (celebrationPayload) {
      const p = celebrationPayload as { group: Group; batchTitle: string; totalAmount: number; count: number };
      const celebrationMsg = 
        `🎉 *TẤT CẢ THÀNH VIÊN ĐÃ HOÀN TẤT ĐÓNG TIỀN!* 🎉\n\n` +
        `📦 Đợt thu: *${p.batchTitle}*\n` +
        `👥 Tiến độ: *${p.count}/${p.count} thành viên đã đóng đủ*\n` +
        `💰 Tổng số tiền: *${p.totalAmount.toLocaleString('vi-VN')}đ*\n\n` +
        `❤️ _Cảm ơn tất cả mọi người đã hoàn tất đóng tiền đầy đủ và đúng hạn!_ 🚀`;
      await telegramService.sendMessage(p.group.chatId, celebrationMsg, p.group.threadId);
    }

    res.json({ success: true, status: newStatus, batchId, memberId });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Xóa đợt thu
apiRouter.delete('/services/:serviceId/batches/:batchId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { serviceId, batchId } = req.params;
    await store.update(s => {
      if (s.expenseBatches) {
        s.expenseBatches = s.expenseBatches.filter(b => !(b.serviceId === serviceId && b.id === batchId));
      }
    });
    res.json({ success: true, message: 'Đã xóa đợt thu thành công' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Cập nhật nhanh số tiền đóng riêng của từng thành viên
apiRouter.put('/services/:serviceId/member-amounts', async (req: Request, res: Response): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const { memberAmounts } = req.body;
    if (!Array.isArray(memberAmounts)) {
      res.status(400).json({ success: false, error: 'Dữ liệu không hợp lệ' });
      return;
    }

    await store.update(s => {
      const members = s.members[serviceId] || [];
      for (const item of memberAmounts) {
        const m = members.find(mem => mem.id === item.memberId);
        if (m) {
          m.customAmount = typeof item.customAmount === 'number' && item.customAmount >= 0 ? item.customAmount : undefined;
        }
      }
    });

    res.json({ success: true, message: 'Đã cập nhật số tiền thành viên' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Lấy danh bạ thành viên đã có trong hệ thống (để chọn nhanh và dùng chung mã CK)
apiRouter.get('/members/directory', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthUserId(req);
    const admin = isUserAdmin(req);
    const state = await store.read();

    const userServices = state.services.filter(s => s.userId === userId || (!s.userId && admin));
    const userServiceIds = userServices.map(s => s.id);

    const directory: Member[] = [];
    const seenMap = new Set<string>();

    for (const svcId of userServiceIds) {
      const members = state.members[svcId] || [];
      for (const m of members) {
        const key = `${m.transferCode.trim().toLowerCase()}__${(m.telegramUsername || '').trim().toLowerCase()}__${m.name.trim().toLowerCase()}`;
        if (!seenMap.has(key)) {
          seenMap.add(key);
          directory.push(m);
        }
      }
    }

    res.json({ success: true, directory });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.post('/services/:serviceId/members', async (req: Request, res: Response): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const validated = MemberSchema.parse(req.body);

    const newMember: Member = {
      id: `mem_${Date.now()}`,
      ...validated,
      createdAt: new Date().toISOString()
    };

    await store.update(s => {
      if (!s.members[serviceId]) {
        s.members[serviceId] = [];
      }
      // Kiểm tra trùng mã chuyển khoản
      const isCodeExist = s.members[serviceId].some(
        (m: Member) => m.transferCode.toLowerCase() === newMember.transferCode.toLowerCase()
      );
      if (isCodeExist) {
        throw new Error(`Mã chuyển khoản "${newMember.transferCode}" đã tồn tại trong dịch vụ này`);
      }
      s.members[serviceId].push(newMember);
    });

    res.json({ success: true, member: newMember });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

apiRouter.put('/services/:serviceId/members/:memberId', async (req: Request, res: Response): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const memberId = req.params.memberId as string;
    const validated = MemberSchema.parse(req.body);

    let updated: Member | undefined;
    await store.update(s => {
      const list: Member[] = s.members[serviceId] || [];
      const idx = list.findIndex((m: Member) => m.id === memberId);
      if (idx === -1) throw new Error('Không tìm thấy thành viên');

      // Kiểm tra trùng mã chuyển khoản với người khác
      const isCodeExist = list.some(
        (m: Member, i: number) => i !== idx && m.transferCode.toLowerCase() === validated.transferCode.toLowerCase()
      );
      if (isCodeExist) {
        throw new Error(`Mã chuyển khoản "${validated.transferCode}" đã được dùng bởi thành viên khác`);
      }

      list[idx] = {
        ...list[idx],
        ...validated
      };
      updated = list[idx];
    });

    res.json({ success: true, member: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

apiRouter.delete('/services/:serviceId/members/:memberId', async (req: Request, res: Response): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const memberId = req.params.memberId as string;
    await store.update(s => {
      if (s.members[serviceId]) {
        s.members[serviceId] = s.members[serviceId].filter((m: Member) => m.id !== memberId);
      }
    });
    res.json({ success: true, message: 'Đã xóa thành viên' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Sao chép thành viên từ dịch vụ khác
apiRouter.post('/services/:serviceId/members/copy', async (req: Request, res: Response): Promise<void> => {
  try {
    const targetServiceId = req.params.serviceId as string;
    const { sourceServiceId, memberIds } = req.body;

    if (!sourceServiceId) {
      res.status(400).json({ success: false, error: 'Vui lòng chọn dịch vụ nguồn' });
      return;
    }

    let addedCount = 0;
    await store.update(s => {
      if (!s.members[targetServiceId]) s.members[targetServiceId] = [];
      const sourceMembers = s.members[sourceServiceId] || [];
      const targetMembers = s.members[targetServiceId];

      const toCopy = Array.isArray(memberIds) && memberIds.length > 0
        ? sourceMembers.filter(m => memberIds.includes(m.id))
        : sourceMembers;

      for (const src of toCopy) {
        // Kiểm tra xem đã có người cùng transferCode hoặc tên chưa
        let newCode = src.transferCode;
        let suffix = 1;
        while (targetMembers.some(tm => tm.transferCode.toLowerCase() === newCode.toLowerCase())) {
          newCode = `${src.transferCode}${suffix++}`;
        }

        const newMem: Member = {
          id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: src.name,
          transferCode: newCode,
          telegramUsername: src.telegramUsername,
          telegramUserId: src.telegramUserId,
          customAmount: src.customAmount,
          active: true,
          createdAt: new Date().toISOString()
        };

        targetMembers.push(newMem);
        addedCount++;
      }
    });

    res.json({ success: true, message: `Đã sao chép ${addedCount} thành viên thành công!`, addedCount });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Chuyển đổi trạng thái đóng tiền thủ công (Toggle Paid/Unpaid)
apiRouter.post('/services/:serviceId/members/:memberId/toggle-paid', async (req: Request, res: Response): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const memberId = req.params.memberId as string;
    const { month } = req.body;
    const targetMonth = month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    let newStatus: string = 'paid';

    await store.update(s => {
      const service = s.services.find(svc => svc.id === serviceId);
      const member = (s.members[serviceId] || []).find((m: Member) => m.id === memberId);
      if (!service || !member) throw new Error('Dịch vụ hoặc thành viên không tồn tại');

      const expected = service.mode === 'per_member' && member.customAmount
        ? member.customAmount
        : (service.defaultAmountPerMember || Math.round(service.totalAmount / (s.members[serviceId]?.length || 1)));

      const paymentIdx = s.monthlyPayments.findIndex(
        p => p.serviceId === serviceId && p.memberId === memberId && p.month === targetMonth
      );

      if (paymentIdx === -1) {
        s.monthlyPayments.push({
          memberId,
          serviceId,
          month: targetMonth,
          expectedAmount: expected,
          paidAmount: expected,
          status: 'paid',
          transactionIds: [],
          paidAt: new Date().toISOString()
        });
        newStatus = 'paid';
      } else {
        const current = s.monthlyPayments[paymentIdx];
        if (current.status === 'paid') {
          current.status = 'unpaid';
          current.paidAmount = 0;
          current.paidAt = undefined;
          newStatus = 'unpaid';
        } else {
          current.status = 'paid';
          current.paidAmount = expected;
          current.paidAt = new Date().toISOString();
          newStatus = 'paid';
        }
      }
    });

    res.json({ success: true, status: newStatus, month: targetMonth });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ==========================================
// 5. GIAO DỊCH & ĐỐI SOÁT (TRANSACTIONS)
// ==========================================
apiRouter.get('/transactions', async (req: Request, res: Response): Promise<void> => {
  const userId = getAuthUserId(req);
  const admin = isUserAdmin(req);
  const { filter, search, limit = '100' } = req.query;
  const state = await store.read();
  
  const userServices = state.services.filter(s => s.userId === userId || (!s.userId && admin));
  const userServiceIds = userServices.map(s => s.id);
  
  let list = state.transactions.filter(t => t.userId === userId || (!t.userId && admin) || userServiceIds.includes(t.serviceId || ''));

  if (filter === 'matched') {
    list = list.filter(t => t.matched);
  } else if (filter === 'unmatched') {
    list = list.filter(t => !t.matched);
  } else if (filter === 'manual') {
    list = list.filter(t => t.manualMatched);
  }

  if (search && typeof search === 'string') {
    const q = search.toLowerCase();
    list = list.filter(
      t => t.content.toLowerCase().includes(q) || t.accountNumber.includes(q) || String(t.amount).includes(q)
    );
  }

  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const parsedLimit = parseInt(limit as string, 10) || 100;

  res.json({
    success: true,
    total: list.length,
    transactions: list.slice(0, parsedLimit)
  });
});

// Gán giao dịch thủ công
apiRouter.post('/transactions/:id/manual-match', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { serviceId, memberId, month } = req.body;

    if (!serviceId || !memberId || !month) {
      res.status(400).json({ success: false, error: 'Vui lòng chọn đầy đủ Dịch vụ, Thành viên và Tháng' });
      return;
    }

    const updatedTx = await reconciliationService.manualMatch(id, serviceId, memberId, month);
    res.json({ success: true, message: 'Gán giao dịch thành công', transaction: updatedTx });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Xóa giao dịch
apiRouter.delete('/transactions/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await store.update(s => {
      s.transactions = s.transactions.filter(t => t.id !== id);
    });
    res.json({ success: true, message: 'Đã xóa giao dịch' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ==========================================
// 6. LỊCH SỬ NHẮC NỢ (RECEIPTS & TRIGGER)
// ==========================================
apiRouter.get('/history', async (req: Request, res: Response): Promise<void> => {
  const userId = getAuthUserId(req);
  const admin = isUserAdmin(req);
  const state = await store.read();
  const userServices = state.services.filter(s => s.userId === userId || (!s.userId && admin));
  const userServiceIds = userServices.map(s => s.id);
  const receipts = (state.reminderReceipts || [])
    .filter(r => r.userId === userId || (!r.userId && admin) || userServiceIds.includes(r.serviceId))
    .slice(0, 200);
  res.json({ success: true, receipts });
});

apiRouter.post('/trigger-scheduler', async (req: Request, res: Response): Promise<void> => {
  try {
    const directResult = await reminderService.scanAndSendIndividualReminders();
    const scheduledResult = await reminderService.checkAndSendReminders(new Date(), true);
    res.json({
      success: true,
      message: `Đã quét ${directResult.scannedServices} dịch vụ (${directResult.unpaidCount} người chưa nộp). Đã gửi ${directResult.directDMSent} tin nhắn riêng (DM) & ${directResult.groupRemindersSent} thông báo nhóm có nút bấm QR riêng.`,
      details: { ...directResult, scheduledResult }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 7. CÔNG CỤ GIẢ LẬP WEBHOOK SEPAY (SIMULATOR)
// ==========================================
apiRouter.post('/simulator/sepay', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountNumber = '0388888888', amount = 65000, content = 'NET-AN CK THANG 9', gateway = 'MBBank' } = req.body;

    const mockPayload = {
      id: Date.now(),
      gateway,
      transactionDate: new Date().toISOString().replace('T', ' ').substring(0, 19),
      accountNumber: String(accountNumber),
      code: null,
      content: String(content),
      transferType: 'in',
      transferAmount: Number(amount),
      accumulated: 10000000,
      subAccount: null,
      referenceCode: `SIM_${Date.now()}`,
      description: `${gateway} ${content}`
    };

    const parseResult = sepayProvider.parseWebhook({}, mockPayload);
    if (!parseResult.isValid || !parseResult.transaction) {
      res.status(400).json({ success: false, error: parseResult.error });
      return;
    }

    const { matched, isDuplicate, transaction } = await reconciliationService.processTransaction(parseResult.transaction);

    res.json({
      success: true,
      message: matched ? '🎯 Đã khớp giao dịch tự động & gửi thông báo Telegram!' : '⚠️ Giao dịch chưa khớp (Đã gửi cảnh báo Admin)',
      matched,
      isDuplicate,
      transaction,
      payload: mockPayload
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 8. ĐỒNG BỘ SEPAY TỰ ĐỘNG QUA USER API (SEPAY SYNC & HUB)
// ==========================================
apiRouter.get('/sepay/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthUserId(req);
    const status = await sepaySyncService.getDetailedStatus(userId);
    res.json({ success: true, ...status });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.post('/sepay/sync', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthUserId(req);
    const { token } = req.body;
    const result = await sepaySyncService.syncTransactions(token, userId);
    res.json({ ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.get('/sepay/config', async (req: Request, res: Response): Promise<void> => {
  const userId = getAuthUserId(req);
  const state = await store.read();
  const currentUser = (state.users || []).find(u => u.id === userId);
  const token = currentUser?.sepayApiToken || state.sepayApiToken || config.SEPAY_API_TOKEN || config.SEPAY_WEBHOOK_SECRET || '';
  res.json({
    success: true,
    hasToken: Boolean(token),
    tokenMasked: token ? `${token.substring(0, 6)}...${token.substring(token.length - 4)}` : '',
    autoSync: currentUser?.sepayAutoSync ?? state.sepayAutoSync ?? true
  });
});

apiRouter.post('/sepay/config', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthUserId(req);
    const { token, autoSync } = req.body;
    await store.update(s => {
      if (!s.users) s.users = [];
      const u = s.users.find(usr => usr.id === userId);
      if (u) {
        if (token !== undefined) {
          u.sepayApiToken = String(token).trim();
        }
        if (autoSync !== undefined) {
          u.sepayAutoSync = Boolean(autoSync);
        }
        u.updatedAt = new Date().toISOString();
      }
    });

    // Kích hoạt đồng bộ ngay để xác thực
    if (token) {
      sepaySyncService.syncTransactions(String(token).trim(), userId).catch(() => {});
    }

    res.json({ success: true, message: 'Đã lưu cấu hình SePay thành công!' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

apiRouter.post('/sepay/apply-to-services', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthUserId(req);
    const { bankCode, accountNumber, accountName } = req.body;
    if (!bankCode || !accountNumber || !accountName) {
      res.status(400).json({ success: false, error: 'Thiếu thông tin tài khoản ngân hàng' });
      return;
    }

    const result = await sepaySyncService.applyBankAccountToAllServices(
      { bankCode, accountNumber, accountName },
      userId
    );

    res.json({
      success: true,
      message: `Đã áp dụng tài khoản ${bankCode} - ${accountNumber} cho ${result.updatedCount} dịch vụ!`,
      updatedCount: result.updatedCount
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 8.5. CẤU HÌNH THÔNG TIN CHỦ THU (USER PROFILE & TELEGRAM CHAT ID)
// ==========================================
apiRouter.get('/user/profile', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthUserId(req);
    const state = await store.read();
    const currentUser = (state.users || []).find(u => u.id === userId);
    if (!currentUser) {
      res.status(404).json({ success: false, error: 'Không tìm thấy thông tin người dùng' });
      return;
    }
    res.json({
      success: true,
      user: {
        id: currentUser.id,
        username: currentUser.username,
        fullName: currentUser.fullName || currentUser.username,
        role: currentUser.role,
        telegramChatId: currentUser.telegramChatId || '',
        sepayAutoSync: currentUser.sepayAutoSync ?? true,
        hasSepayToken: Boolean(currentUser.sepayApiToken)
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.post('/user/profile', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthUserId(req);
    const { fullName, telegramChatId, syncToGroups } = req.body;
    let updatedUser: any;

    await store.update(s => {
      if (!s.users) s.users = [];
      const u = s.users.find(usr => usr.id === userId);
      if (!u) throw new Error('Không tìm thấy tài khoản người dùng');

      if (fullName !== undefined) u.fullName = String(fullName).trim();
      if (telegramChatId !== undefined) {
        const cleanChatId = String(telegramChatId).trim();
        u.telegramChatId = cleanChatId;

        // Tự động gán alertChatId cho các nhóm của user nếu nhóm chưa có hoặc nếu yêu cầu sync
        for (const g of s.groups) {
          if (g.userId === userId && (!g.alertChatId || syncToGroups === true)) {
            g.alertChatId = cleanChatId;
          }
        }
      }
      u.updatedAt = new Date().toISOString();
      updatedUser = u;
    });

    res.json({
      success: true,
      message: 'Đã lưu cấu hình Chat ID Chủ Thu thành công!',
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        fullName: updatedUser.fullName,
        telegramChatId: updatedUser.telegramChatId
      }
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ==========================================
// 9. SAO LƯU & PHỤC HỒI DỮ LIỆU (BACKUP & RESTORE)
// ==========================================
apiRouter.get('/backup', async (req: Request, res: Response): Promise<void> => {
  const state = await store.read();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=state_backup_${new Date().toISOString().substring(0, 10)}.json`);
  res.send(JSON.stringify(state, null, 2));
});

apiRouter.post('/restore', async (req: Request, res: Response): Promise<void> => {
  try {
    const { state } = req.body;
    if (!state || typeof state !== 'object' || !Array.isArray(state.groups) || !Array.isArray(state.services)) {
      res.status(400).json({ success: false, error: 'Dữ liệu khôi phục không đúng cấu trúc AppState' });
      return;
    }
    await store.restore(state);
    res.json({ success: true, message: 'Khôi phục dữ liệu thành công!' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ==========================================
// 10. QUẢN LÝ NGƯỜI DÙNG DÀNH CHO ADMIN (ADMIN USER MANAGEMENT)
// ==========================================

/**
 * GET /api/admin/users - Danh sách người dùng hệ thống kèm số liệu thống kê
 */
apiRouter.get('/admin/users', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const currentUserId = getAuthUserId(req);
    const state = await store.read();
    const users = (state.users || []).map(u => {
      const groupCount = state.groups.filter(g => g.userId === u.id).length;
      const serviceCount = state.services.filter(s => s.userId === u.id).length;
      const batchCount = (state.expenseBatches || []).filter(b => b.userId === u.id).length;
      const isCurrent = u.id === currentUserId;
      const canDelete = !isCurrent && u.username !== 'admin';

      return {
        id: u.id,
        username: u.username,
        fullName: u.fullName || u.username,
        role: u.role,
        hasSepayToken: Boolean(u.sepayApiToken),
        sepayAutoSync: u.sepayAutoSync ?? true,
        groupCount,
        serviceCount,
        batchCount,
        isCurrent,
        canDelete,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt
      };
    });

    res.json({
      success: true,
      users,
      totalUsers: users.length,
      currentUserId
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/admin/users/:id - Xóa tài khoản người dùng và dọn sạch dữ liệu liên quan
 */
apiRouter.delete('/admin/users/:id', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const targetUserId = req.params.id;
    const currentUserId = getAuthUserId(req);

    if (targetUserId === currentUserId) {
      res.status(400).json({ success: false, error: 'Không thể xóa tài khoản bạn đang đăng nhập hiện tại.' });
      return;
    }

    const state = await store.read();
    const targetUser = (state.users || []).find(u => u.id === targetUserId);

    if (!targetUser) {
      res.status(404).json({ success: false, error: 'Tài khoản người dùng không tồn tại.' });
      return;
    }

    if (targetUser.username === 'admin') {
      res.status(400).json({ success: false, error: 'Không thể xóa tài khoản Quản trị viên gốc (admin).' });
      return;
    }

    // Thực hiện Cascade Delete toàn bộ dữ liệu của User này
    await store.update(s => {
      const userServices = (s.services || []).filter(svc => svc.userId === targetUserId);
      const userServiceIds = userServices.map(svc => svc.id);

      // 1. Xóa user
      s.users = (s.users || []).filter(u => u.id !== targetUserId);

      // 2. Xóa các nhóm
      s.groups = (s.groups || []).filter(g => g.userId !== targetUserId);

      // 3. Xóa các dịch vụ & thành viên
      s.services = (s.services || []).filter(svc => svc.userId !== targetUserId);
      for (const svcId of userServiceIds) {
        if (s.members && s.members[svcId]) {
          delete s.members[svcId];
        }
      }

      // 4. Xóa các đợt chi tiêu
      s.expenseBatches = (s.expenseBatches || []).filter(b => b.userId !== targetUserId && !userServiceIds.includes(b.serviceId));

      // 5. Xóa các giao dịch
      s.transactions = (s.transactions || []).filter(t => t.userId !== targetUserId && !userServiceIds.includes(t.serviceId || ''));

      // 6. Xóa các reminder receipts
      s.reminderReceipts = (s.reminderReceipts || []).filter(r => r.userId !== targetUserId && !userServiceIds.includes(r.serviceId));

      // 7. Xóa bảng thanh toán tháng
      s.monthlyPayments = (s.monthlyPayments || []).filter(p => !userServiceIds.includes(p.serviceId));
    });

    console.log(`🗑️ [ADMIN ACTION] Đã xóa tài khoản user "${targetUser.username}" (${targetUser.id}) cùng toàn bộ dữ liệu.`);

    res.json({
      success: true,
      message: `Đã xóa tài khoản "${targetUser.fullName || targetUser.username}" và toàn bộ dữ liệu thành công.`
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/users/:id/reset-password - Admin đổi mật khẩu cho người dùng
 */
apiRouter.post('/admin/users/:id/reset-password', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const targetUserId = req.params.id;
    const { newPassword } = req.body;

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      res.status(400).json({ success: false, error: 'Mật khẩu mới phải có độ dài tối thiểu 6 ký tự.' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    let updatedUsername = '';

    await store.update(s => {
      const user = (s.users || []).find(u => u.id === targetUserId);
      if (!user) {
        throw new Error('Tài khoản người dùng không tồn tại.');
      }
      user.passwordHash = passwordHash;
      user.updatedAt = new Date().toISOString();
      updatedUsername = user.username;
    });

    res.json({
      success: true,
      message: `Đã cập nhật mật khẩu mới cho tài khoản "${updatedUsername}" thành công!`
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/cleanup-batches - Kích hoạt dọn dẹp thủ công các đợt thu tiền đã hoàn tất > 7 ngày
 */
apiRouter.post('/admin/cleanup-batches', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const retentionDays = Number(req.body?.retentionDays) || 7;
    const result = await reminderService.cleanupCompletedBatches(retentionDays);

    res.json({
      success: true,
      message: result.cleanedCount > 0
        ? `Đã dọn dẹp thành công ${result.cleanedCount} đợt thu tiền đã hoàn tất quá ${retentionDays} ngày.`
        : `Không có đợt thu tiền nào hoàn tất quá ${retentionDays} ngày cần dọn dẹp.`,
      ...result
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

