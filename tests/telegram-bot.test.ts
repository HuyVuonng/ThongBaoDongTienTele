import { describe, it, expect } from 'vitest';
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
