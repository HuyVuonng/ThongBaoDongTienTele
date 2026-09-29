import { describe, it, expect, beforeEach } from 'vitest';
import { TelegramBotService } from '../src/bot/telegram.js';
import { Service, Group, AppState } from '../src/types.js';

describe('TelegramBotService Collector Resolution & Hybrid Verification Tests', () => {
  const telegramService = TelegramBotService.getInstance();

  const mockState: Partial<AppState> = {
    usernameMappings: {
      'huyvuong': '6817605055',
      'leader_spotify': '1122334455'
    },
    users: [
      {
        id: 'usr_admin',
        username: 'admin',
        passwordHash: '',
        role: 'admin',
        telegramUsername: 'admin_boss',
        telegramChatId: '9988776655',
        createdAt: '',
        updatedAt: ''
      }
    ],
    members: {
      'svc-1': [
        {
          id: 'm1',
          name: 'Nguyen Van A',
          telegramUsername: 'member_a',
          telegramUserId: '5544332211',
          transferCode: 'NET-A',
          active: true,
          createdAt: ''
        }
      ]
    }
  };

  it('nên phân giải collector theo username khi service cấu hình collectorUsername và có mapping chatId', () => {
    const service: Partial<Service> = {
      collectorUsername: '@huyvuong'
    };
    const result = telegramService.resolveCollector(service as Service, undefined, mockState as AppState);

    expect(result.username).toBe('huyvuong');
    expect(result.chatId).toBe('6817605055');
    expect(result.tag).toBe('@huyvuong');
  });

  it('nên phân giải collector khi username chưa có trong mapping (chưa /start) nhưng vẫn trả về đúng username & tag để tag trong nhóm', () => {
    const service: Partial<Service> = {
      collectorUsername: '@new_collector_xyz'
    };
    const result = telegramService.resolveCollector(service as Service, undefined, mockState as AppState);

    expect(result.username).toBe('new_collector_xyz');
    expect(result.chatId).toBeUndefined();
    expect(result.tag).toBe('@new_collector_xyz');
  });

  it('nên fallback về group alertUsername hoặc alertChatId nếu service không chỉ định', () => {
    const service: Partial<Service> = {};
    const group: Partial<Group> = {
      alertUsername: '@leader_spotify'
    };
    const result = telegramService.resolveCollector(service as Service, group as Group, mockState as AppState);

    expect(result.username).toBe('leader_spotify');
    expect(result.chatId).toBe('1122334455');
    expect(result.tag).toBe('@leader_spotify');
  });

  it('nên fallback về user profile owner nếu cả service và group đều không có', () => {
    const service: Partial<Service> = { userId: 'usr_admin' };
    const group: Partial<Group> = {};
    const result = telegramService.resolveCollector(service as Service, group as Group, mockState as AppState);

    expect(result.username).toBe('admin_boss');
    expect(result.chatId).toBe('9988776655');
    expect(result.tag).toBe('@admin_boss');
  });

  it('nên tự động xử lý khi người dùng nhập nhầm @username vào trường collectorChatId', () => {
    const service: Partial<Service> = {
      collectorChatId: '@huyvuong'
    };
    const result = telegramService.resolveCollector(service as Service, undefined, mockState as AppState);

    expect(result.username).toBe('huyvuong');
    expect(result.chatId).toBe('6817605055');
    expect(result.tag).toBe('@huyvuong');
  });
});

describe('TelegramBotService /guitien and Member Payment Resolution Tests', () => {
  const telegramService = TelegramBotService.getInstance();

  const mockGroup: Group = {
    id: 'grp-1',
    chatId: '-10099887766',
    title: 'Nhóm Netflix & Spotify',
    active: true,
    createdAt: '',
    updatedAt: ''
  };

  const mockService: Service = {
    id: 'svc-1',
    groupId: 'grp-1',
    name: 'Netflix Premium 4K',
    scheduleType: 'monthly',
    mode: 'per_member',
    totalAmount: 260000,
    defaultAmountPerMember: 65000,
    transferPrefix: 'NET',
    bankInfo: {
      bankCode: 'MB',
      accountNumber: '0988888888',
      accountName: 'VUONG HUY'
    },
    messageTemplate: '',
    active: true,
    createdAt: '',
    updatedAt: ''
  };

  const mockState: Partial<AppState> = {
    groups: [mockGroup],
    services: [mockService],
    members: {
      'svc-1': [
        {
          id: 'm1',
          name: 'Nguyen Van A',
          telegramUsername: 'member_a',
          telegramUserId: '5544332211',
          transferCode: 'NET-A',
          customAmount: 65000,
          active: true,
          createdAt: ''
        },
        {
          id: 'm2',
          name: 'Tran Thi B',
          telegramUsername: 'member_b',
          transferCode: 'NET-B',
          customAmount: 65000,
          active: true,
          createdAt: ''
        }
      ]
    },
    monthlyPayments: [],
    expenseBatches: []
  };

  it('nên bắt đúng thông tin thành viên theo username khi người dùng nhắn /guitien trong nhóm', () => {
    const result = telegramService.resolveMemberPaymentInfo(
      {
        chatId: '-10099887766',
        isGroup: true,
        senderUsername: 'member_a',
        senderId: '5544332211'
      },
      mockState as AppState
    );

    expect(result.success).toBe(true);
    expect(result.targetUsername).toBe('member_a');
    expect(result.memberName).toBe('Nguyen Van A');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].service.id).toBe('svc-1');
    expect(result.items[0].amount).toBe(65000);
    expect(result.items[0].transferCode).toBe('NET-A');
    expect(result.items[0].status).toBe('unpaid');
  });

  it('nên hỗ trợ chỉ định đích danh thành viên khi nhắn /guitien @member_b hoặc theo tên', () => {
    const result = telegramService.resolveMemberPaymentInfo(
      {
        chatId: '-10099887766',
        isGroup: true,
        senderUsername: 'member_a',
        targetArg: '@member_b'
      },
      mockState as AppState
    );

    expect(result.success).toBe(true);
    expect(result.targetUsername).toBe('member_b');
    expect(result.memberName).toBe('Tran Thi B');
    expect(result.items[0].transferCode).toBe('NET-B');
  });

  it('nên phát hiện khi thành viên đã hoàn tất đóng tiền trong tháng', () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const stateWithPaid: Partial<AppState> = {
      ...mockState,
      monthlyPayments: [
        {
          memberId: 'm1',
          serviceId: 'svc-1',
          month: currentMonth,
          expectedAmount: 65000,
          paidAmount: 65000,
          status: 'paid',
          transactionIds: [],
          paidAt: new Date().toISOString()
        }
      ]
    };

    const result = telegramService.resolveMemberPaymentInfo(
      {
        chatId: '-10099887766',
        isGroup: true,
        senderUsername: 'member_a'
      },
      stateWithPaid as AppState
    );

    expect(result.success).toBe(true);
    expect(result.items[0].status).toBe('paid');
  });

  it('nên bao gồm cả các đợt thu phát sinh (Expense Batches) đang active của thành viên', () => {
    const stateWithBatch: Partial<AppState> = {
      ...mockState,
      expenseBatches: [
        {
          id: 'batch-1',
          serviceId: 'svc-1',
          groupId: 'grp-1',
          title: 'Tiền mua tài khoản Premium thêm tháng 9',
          totalAmount: 100000,
          status: 'active',
          sentAt: new Date().toISOString(),
          members: [
            {
              memberId: 'm1',
              name: 'Nguyen Van A',
              telegramUsername: 'member_a',
              transferCode: 'NET-A',
              amount: 50000,
              status: 'unpaid'
            }
          ]
        }
      ]
    };

    const result = telegramService.resolveMemberPaymentInfo(
      {
        chatId: '-10099887766',
        isGroup: true,
        senderUsername: 'member_a'
      },
      stateWithBatch as AppState
    );

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(2); // 1 monthly service + 1 batch
    expect(result.items.some(it => it.type === 'batch' && it.amount === 50000)).toBe(true);
  });

  it('nên báo lỗi rõ ràng nếu nhóm chưa được liên kết với Web Dashboard', () => {
    const result = telegramService.resolveMemberPaymentInfo(
      {
        chatId: '-999999999',
        isGroup: true,
        senderUsername: 'member_a'
      },
      mockState as AppState
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('chưa được liên kết');
  });

  it('khi thành viên tham gia nhiều dịch vụ (1 đã đóng, 1 chưa đóng) thì chỉ lấy dịch vụ chưa đóng', () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const svc2: Service = {
      id: 'svc-2',
      groupId: 'grp-1',
      name: 'Spotify Family',
      scheduleType: 'monthly',
      mode: 'per_member',
      totalAmount: 180000,
      defaultAmountPerMember: 30000,
      transferPrefix: 'SP',
      bankInfo: {
        bankCode: 'MB',
        accountNumber: '0988888888',
        accountName: 'VUONG HUY'
      },
      messageTemplate: '',
      active: true,
      createdAt: '',
      updatedAt: ''
    };

    const multiServiceState: Partial<AppState> = {
      ...mockState,
      services: [mockService, svc2],
      members: {
        'svc-1': [
          {
            id: 'm1',
            name: 'Nguyen Van A',
            telegramUsername: 'member_a',
            transferCode: 'NET-A',
            customAmount: 65000,
            active: true,
            createdAt: ''
          }
        ],
        'svc-2': [
          {
            id: 'm1_sp',
            name: 'Nguyen Van A',
            telegramUsername: 'member_a',
            transferCode: 'SP-A',
            customAmount: 30000,
            active: true,
            createdAt: ''
          }
        ]
      },
      monthlyPayments: [
        {
          memberId: 'm1',
          serviceId: 'svc-1',
          month: currentMonth,
          expectedAmount: 65000,
          paidAmount: 65000,
          status: 'paid',
          transactionIds: [],
          paidAt: new Date().toISOString()
        }
      ]
    };

    const result = telegramService.resolveMemberPaymentInfo(
      {
        chatId: '-10099887766',
        isGroup: true,
        senderUsername: 'member_a'
      },
      multiServiceState as AppState
    );

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(2);

    const paidItems = result.items.filter(it => it.status === 'paid');
    const unpaidItems = result.items.filter(it => it.status !== 'paid');

    expect(paidItems).toHaveLength(1);
    expect(paidItems[0].service.id).toBe('svc-1'); // Netflix đã đóng

    expect(unpaidItems).toHaveLength(1);
    expect(unpaidItems[0].service.id).toBe('svc-2'); // Spotify chưa đóng -> chỉ bắn QR của Spotify
    expect(unpaidItems[0].amount).toBe(30000);
  });

  it('nên xử lý an toàn username có dấu gạch dưới _ như @chuongph_geoit và @duynle_geoit trong formatTag', () => {
    expect(telegramService.formatTag('chuongph_geoit', 'Chuong PH')).toBe('@chuongph\\_geoit');
    expect(telegramService.formatTag('@duynle_geoit_2026', 'Duy Le')).toBe('@duynle\\_geoit\\_2026');
    expect(telegramService.formatTag(undefined, 'Nguyen Van A')).toBe('*Nguyen Van A*');
    expect(telegramService.formatTag('', '')).toBe('Thành viên');
  });

  it('nên escapeMarkdown đúng các ký tự markdown nhạy cảm và stripMarkdown khi fallback', () => {
    const raw = 'Hello _world_ *bold* `code` [link]';
    const escaped = telegramService.escapeMarkdown(raw);
    expect(escaped).toBe('Hello \\_world\\_ \\*bold\\* \\`code\\` \\[link\\]');

    const stripped = telegramService.stripMarkdown(raw);
    expect(stripped).toBe('Hello world bold code [link]');
  });

  it('nên phân giải đúng collector với safeTag có escape khi username chứa dấu gạch dưới', () => {
    const service: Partial<Service> = {
      collectorUsername: '@lead_boss_99'
    };
    const result = telegramService.resolveCollector(service as Service, undefined, mockState as AppState);

    expect(result.username).toBe('lead_boss_99');
    expect(result.tag).toBe('@lead_boss_99');
    expect(result.safeTag).toBe('@lead\\_boss\\_99');
  });
});

describe('TelegramBotService refreshGroupPaymentAnnouncement Tests', () => {
  const telegramService = TelegramBotService.getInstance();
  const store = (telegramService as any).store;

  const testGroup: Group = {
    id: 'grp-refresh-1',
    chatId: '-100888777666',
    title: 'Nhóm Test Refresh',
    active: true,
    createdAt: '',
    updatedAt: ''
  };

  const testService: Service = {
    id: 'svc-refresh-1',
    groupId: 'grp-refresh-1',
    name: 'Netflix Family',
    scheduleType: 'monthly',
    mode: 'per_member',
    totalAmount: 200000,
    defaultAmountPerMember: 100000,
    transferPrefix: 'NET',
    bankInfo: {
      bankCode: 'MB',
      accountNumber: '123456789',
      accountName: 'TEST ADMIN'
    },
    messageTemplate: '',
    active: true,
    createdAt: '',
    updatedAt: ''
  };

  beforeEach(async () => {
    await store.update((s: AppState) => {
      s.groups = (s.groups || []).filter(g => g.id !== 'grp-refresh-1' && g.id !== 'grp-by-svc-1');
      s.services = (s.services || []).filter(svc => svc.id !== 'svc-refresh-1' && svc.id !== 'svc-by-svc-1');
      s.expenseBatches = (s.expenseBatches || []).filter(b => !b.id.startsWith('batch-refresh-') && !b.id.startsWith('batch-by-service-'));
    });
  });

  it('nên xóa tin nhắn cũ và gửi thông báo mới chỉ còn thành viên chưa nộp tiền', async () => {
    const deletedMessages: { chatId: string; messageId: number }[] = [];
    const sentMessagesWithButtons: any[] = [];
    const celebrationMessages: any[] = [];

    telegramService.deleteMessage = async (chatId: string, messageId: number) => {
      deletedMessages.push({ chatId, messageId });
      return true;
    };

    telegramService.sendMessageWithButtons = async (chatId: string, messageText: string, buttons: any[], threadId?: number) => {
      sentMessagesWithButtons.push({ chatId, messageText, buttons, threadId });
      return { success: true, messageId: 999111 };
    };

    telegramService.sendMessage = async (chatId: string, messageText: string, threadId?: number) => {
      celebrationMessages.push({ chatId, messageText, threadId });
      return true;
    };

    await store.update((s: AppState) => {
      s.groups.push(testGroup);
      s.services.push(testService);
      if (!s.expenseBatches) s.expenseBatches = [];
      s.expenseBatches.push({
        id: 'batch-refresh-1',
        serviceId: 'svc-refresh-1',
        groupId: 'grp-refresh-1',
        title: 'Netflix Tháng 09/2026',
        totalAmount: 200000,
        messageId: 555666,
        status: 'active',
        sentAt: new Date().toISOString(),
        members: [
          {
            memberId: 'mem-1',
            name: 'Nguyen Van A',
            telegramUsername: 'user_a',
            transferCode: 'NET-A',
            amount: 100000,
            status: 'paid'
          },
          {
            memberId: 'mem-2',
            name: 'Tran Thi B',
            telegramUsername: 'user_b',
            transferCode: 'NET-B',
            amount: 100000,
            status: 'unpaid'
          }
        ]
      });
    });

    const result = await telegramService.refreshGroupPaymentAnnouncement({
      batchId: 'batch-refresh-1'
    });

    expect(result.success).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.messageId).toBe(999111);

    // Kiểm tra tin nhắn cũ bị xóa
    expect(deletedMessages.some(d => d.chatId === '-100888777666' && d.messageId === 555666)).toBe(true);

    // Kiểm tra thông báo mới chỉ còn 1 nút bấm cho Tran Thi B (người chưa nộp)
    expect(sentMessagesWithButtons).toHaveLength(1);
    const lastSent = sentMessagesWithButtons[0];
    expect(lastSent.buttons).toHaveLength(1);
    expect(lastSent.buttons[0].text).toContain('Tran Thi B');
    expect(lastSent.buttons[0].callbackData).toBe('pay_batch:batch-refresh-1:mem-2');

    // Kiểm tra state đã được cập nhật messageId mới
    const stateAfter = await store.read();
    const batchAfter = (stateAfter.expenseBatches || []).find((b: ExpenseBatch) => b.id === 'batch-refresh-1');
    expect(batchAfter?.messageId).toBe(999111);
  });

  it('khi tất cả thành viên đã nộp đủ 100%, nên chuyển đợt thu sang completed và gửi thông báo chúc mừng', async () => {
    const celebrationMessages: any[] = [];
    telegramService.sendMessage = async (chatId: string, messageText: string, threadId?: number) => {
      celebrationMessages.push({ chatId, messageText, threadId });
      return true;
    };

    telegramService.deleteMessage = async () => true;

    await store.update((s: AppState) => {
      s.groups.push(testGroup);
      s.services.push(testService);
      if (!s.expenseBatches) s.expenseBatches = [];
      s.expenseBatches.push({
        id: 'batch-refresh-completed',
        serviceId: 'svc-refresh-1',
        groupId: 'grp-refresh-1',
        title: 'Netflix Đã Thu Đủ',
        totalAmount: 200000,
        status: 'active',
        sentAt: new Date().toISOString(),
        members: [
          {
            memberId: 'mem-1',
            name: 'Nguyen Van A',
            telegramUsername: 'user_a',
            transferCode: 'NET-A',
            amount: 100000,
            status: 'paid'
          },
          {
            memberId: 'mem-2',
            name: 'Tran Thi B',
            telegramUsername: 'user_b',
            transferCode: 'NET-B',
            amount: 100000,
            status: 'paid'
          }
        ]
      });
    });

    const result = await telegramService.refreshGroupPaymentAnnouncement({
      batchId: 'batch-refresh-completed'
    });

    expect(result.success).toBe(true);
    expect(result.completed).toBe(true);

    // Kiểm tra state đợt thu đã chuyển sang completed
    const stateAfter = await store.read();
    const batchAfter = (stateAfter.expenseBatches || []).find((b: ExpenseBatch) => b.id === 'batch-refresh-completed');
    expect(batchAfter?.status).toBe('completed');
    expect(batchAfter?.completedNotificationSent).toBe(true);
    expect(batchAfter?.completedAt).toBeDefined();

    // Kiểm tra tin nhắn chúc mừng đã được gửi vào nhóm
    expect(celebrationMessages).toHaveLength(1);
    expect(celebrationMessages[0].messageText).toContain('TẤT CẢ THÀNH VIÊN ĐÃ HOÀN TẤT ĐÓNG TIỀN');
    expect(celebrationMessages[0].chatId).toBe('-100888777666');
  });

  it('nên tự động tìm đúng batch theo serviceId khi không truyền batchId trực tiếp', async () => {
    const deletedMessages: { chatId: string; messageId: number }[] = [];
    const sentMessagesWithButtons: any[] = [];

    telegramService.deleteMessage = async (chatId: string, messageId: number) => {
      deletedMessages.push({ chatId, messageId });
      return true;
    };

    telegramService.sendMessageWithButtons = async (chatId: string, messageText: string, buttons: any[], threadId?: number) => {
      sentMessagesWithButtons.push({ chatId, messageText, buttons, threadId });
      return { success: true, messageId: 999222 };
    };

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const testGroup2: Group = {
      id: 'grp-by-svc-1',
      chatId: '-100999888777',
      title: 'Nhóm By Svc',
      active: true,
      createdAt: '',
      updatedAt: ''
    };

    const testService2: Service = {
      id: 'svc-by-svc-1',
      groupId: 'grp-by-svc-1',
      name: 'Spotify By Svc',
      scheduleType: 'monthly',
      mode: 'per_member',
      totalAmount: 150000,
      bankInfo: {
        bankCode: 'MB',
        accountNumber: '123456789',
        accountName: 'TEST ADMIN'
      },
      messageTemplate: '',
      active: true,
      createdAt: '',
      updatedAt: ''
    };

    await store.update((s: AppState) => {
      s.groups.push(testGroup2);
      s.services.push(testService2);
      if (!s.expenseBatches) s.expenseBatches = [];
      s.expenseBatches.push({
        id: 'batch-by-service-1',
        serviceId: 'svc-by-svc-1',
        groupId: 'grp-by-svc-1',
        title: 'Spotify Active Batch',
        month: currentMonth,
        totalAmount: 150000,
        messageId: 777888,
        status: 'active',
        sentAt: new Date().toISOString(),
        members: [
          {
            memberId: 'mem-1',
            name: 'Nguyen Van A',
            telegramUsername: 'user_a',
            transferCode: 'SP-A',
            amount: 150000,
            status: 'unpaid'
          }
        ]
      });
    });

    const result = await telegramService.refreshGroupPaymentAnnouncement({
      serviceId: 'svc-by-svc-1'
    });

    expect(result.success).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.messageId).toBe(999222);

    // Kiểm tra tin nhắn cũ bị xóa
    expect(deletedMessages.some(d => d.chatId === '-100999888777' && d.messageId === 777888)).toBe(true);
    expect(sentMessagesWithButtons).toHaveLength(1);
  });
});


