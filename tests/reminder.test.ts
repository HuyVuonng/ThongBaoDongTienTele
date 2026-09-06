import { describe, it, expect } from 'vitest';
import { ReminderService } from '../src/services/reminder.service.js';
import { SepayProvider } from '../src/providers/sepay.provider.js';
import { Service, Group, Member } from '../src/types.js';

describe('ReminderService & VietQR Provider Unit Tests', () => {
  const reminderService = ReminderService.getInstance();
  const sepayProvider = new SepayProvider();

  const mockGroup: Group = {
    id: 'grp-test',
    chatId: '-1001234567890',
    title: 'Nhóm Gia Đình',
    active: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z'
  };

  const mockService: Service = {
    id: 'svc-spotify',
    groupId: 'grp-test',
    name: 'Spotify Premium Family',
    reminderDay: 10,
    reminderTime: '08:00',
    mode: 'per_member',
    totalAmount: 180000,
    defaultAmountPerMember: 30000,
    transferPrefix: 'SP',
    bankInfo: {
      bankCode: 'MB',
      accountNumber: '0388888888',
      accountName: 'NGUYEN VAN ADMIN'
    },
    messageTemplate: '🔔 [NHẮC {serviceName} THÁNG {month}] Nhóm: {groupName}. Tổng: {totalAmount}đ. STK: {accountNumber}',
    active: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z'
  };

  const mockMembers: Member[] = [
    {
      id: 'm1',
      name: 'Nguyễn Văn A',
      telegramUsername: 'user_a',
      transferCode: 'SP-A',
      active: true,
      createdAt: ''
    }
  ];

  it('nên tạo link VietQR chuẩn NAPAS 247 đúng định dạng', () => {
    const qrUrl = sepayProvider.generateQRUrl({
      bankInfo: mockService.bankInfo,
      amount: 30000,
      description: 'SP 09/2026',
      template: 'compact2'
    });

    expect(qrUrl).toContain('https://img.vietqr.io/image/MB-0388888888-compact2.png');
    expect(qrUrl).toContain('amount=30000');
    expect(qrUrl).toContain('addInfo=SP%2009%2F2026');
    expect(qrUrl).toContain('accountName=NGUYEN%20VAN%20ADMIN');
  });

  it('nên thay thế đầy đủ các biến placeholder trong message template', () => {
    const { message, qrUrl } = reminderService.renderMessageTemplate(mockService, mockGroup, mockMembers, '09/2026');

    expect(message).toContain('Spotify Premium Family');
    expect(message).toContain('09/2026');
    expect(message).toContain('Nhóm Gia Đình');
    expect(message).toContain('180.000đ');
    expect(message).toContain('0388888888');
    expect(qrUrl).toBeDefined();
  });

  it('nên dọn dẹp các đợt thu tiền đã hoàn tất quá 7 ngày', async () => {
    const store = (reminderService as any).store;
    const now = Date.now();
    const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

    await store.update((state: any) => {
      state.expenseBatches = [
        {
          id: 'batch-old-completed',
          serviceId: 'svc-1',
          title: 'Tiền ăn cũ 10 ngày trước',
          status: 'completed',
          completedAt: tenDaysAgo,
          sentAt: tenDaysAgo,
          members: [{ memberId: 'm1', name: 'A', transferCode: 'A', amount: 50000, status: 'paid' }]
        },
        {
          id: 'batch-recent-completed',
          serviceId: 'svc-1',
          title: 'Tiền ăn mới 2 ngày trước',
          status: 'completed',
          completedAt: twoDaysAgo,
          sentAt: twoDaysAgo,
          members: [{ memberId: 'm1', name: 'A', transferCode: 'A', amount: 50000, status: 'paid' }]
        },
        {
          id: 'batch-active',
          serviceId: 'svc-1',
          title: 'Tiền ăn đang thu',
          status: 'active',
          sentAt: tenDaysAgo,
          members: [{ memberId: 'm1', name: 'A', transferCode: 'A', amount: 50000, status: 'unpaid' }]
        }
      ];
    });

    const result = await reminderService.cleanupCompletedBatches(7);
    expect(result.cleanedCount).toBe(1);
    expect(result.deletedBatchTitles).toContain('Tiền ăn cũ 10 ngày trước');

    const state = await store.read();
    expect(state.expenseBatches.find((b: any) => b.id === 'batch-old-completed')).toBeUndefined();
    expect(state.expenseBatches.find((b: any) => b.id === 'batch-recent-completed')).toBeDefined();
    expect(state.expenseBatches.find((b: any) => b.id === 'batch-active')).toBeDefined();
  });
});

