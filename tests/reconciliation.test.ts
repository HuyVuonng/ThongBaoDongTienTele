import { describe, it, expect, beforeEach } from 'vitest';
import { ReconciliationService } from '../src/services/reconciliation.service.js';
import { Service, Group, Member } from '../src/types.js';

describe('ReconciliationService Unit Tests', () => {
  const service = ReconciliationService.getInstance();

  const mockGroups: Group[] = [
    {
      id: 'grp-1',
      chatId: '-1001234567890',
      title: 'Nhóm Test',
      active: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z'
    }
  ];

  const mockServices: Service[] = [
    {
      id: 'svc-netflix',
      groupId: 'grp-1',
      name: 'Netflix Family',
      reminderDay: 5,
      reminderTime: '08:00',
      mode: 'per_member',
      totalAmount: 260000,
      defaultAmountPerMember: 65000,
      transferPrefix: 'NET',
      bankInfo: {
        bankCode: 'MB',
        accountNumber: '0388888888',
        accountName: 'NGUYEN VAN ADMIN'
      },
      messageTemplate: 'Thong bao dong tien',
      active: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z'
    }
  ];

  const mockMembers: Record<string, Member[]> = {
    'svc-netflix': [
      {
        id: 'mem-an',
        name: 'Hoàng An',
        telegramUsername: 'hoangan99',
        transferCode: 'NET-AN',
        customAmount: 65000,
        active: true,
        createdAt: '2026-09-01T00:00:00.000Z'
      },
      {
        id: 'mem-binh',
        name: 'Thanh Bình',
        telegramUsername: 'binhtran',
        transferCode: 'NET-BINH',
        customAmount: 65000,
        active: true,
        createdAt: '2026-09-01T00:00:00.000Z'
      }
    ]
  };

  it('nên trích xuất đúng tháng từ nội dung chuyển khoản', () => {
    const fixedDate = new Date('2026-09-15T00:00:00.000Z');

    expect(service.extractMonth('NET-AN 09/2026', fixedDate)).toBe('2026-09');
    expect(service.extractMonth('NET-AN T09', fixedDate)).toBe('2026-09');
    expect(service.extractMonth('NET AN THANG 9', fixedDate)).toBe('2026-09');
    expect(service.extractMonth('NET-AN CK', fixedDate)).toBe('2026-09'); // Fallback default
  });

  it('nên khớp thành viên đúng với mã NET-AN', () => {
    const match1 = service.findMatch('MBBank 12345 NET-AN CK THANG 9', mockServices, mockMembers, mockGroups);
    expect(match1.matched).toBe(true);
    expect(match1.member?.id).toBe('mem-an');
    expect(match1.service?.id).toBe('svc-netflix');
    expect(match1.group?.id).toBe('grp-1');
  });

  it('nên khớp thành viên khi người dùng gõ không dấu hoặc khoảng trắng (net an)', () => {
    const match = service.findMatch('Chuyen tien net an thang 9', mockServices, mockMembers, mockGroups);
    expect(match.matched).toBe(true);
    expect(match.member?.id).toBe('mem-an');
  });

  it('không nên khớp khi nội dung chuyển khoản không có mã hợp lệ', () => {
    const match = service.findMatch('Chuyen tien an trua cafe', mockServices, mockMembers, mockGroups);
    expect(match.matched).toBe(false);
  });

  it('nên trích xuất đúng tháng cho các định dạng khác nhau', () => {
    const date = new Date('2026-09-06T18:00:00.000Z');
    expect(service.extractMonth('NET-AN 09 2026', date)).toBe('2026-09');
    expect(service.extractMonth('NET-AN THANG 9', date)).toBe('2026-09');
    expect(service.extractMonth('NET-AN T10', date)).toBe('2026-10');
  });

  it('nên khớp chính xác khi ngân hàng bỏ dấu gạch nối (A-HUY -> AHUY hoặc TEST AHUY)', () => {
    const testServices: Service[] = [
      {
        id: 'svc-test',
        groupId: 'grp-1',
        name: 'Dịch vụ Test',
        reminderDay: 5,
        reminderTime: '08:00',
        mode: 'shared',
        totalAmount: 50000,
        transferPrefix: 'TEST',
        bankInfo: { bankCode: 'VCB', accountNumber: '1017409054', accountName: 'VUONG QUANG HUY' },
        messageTemplate: '',
        active: true,
        createdAt: '',
        updatedAt: ''
      }
    ];

    const testMembers: Record<string, Member[]> = {
      'svc-test': [
        {
          id: 'mem-huy',
          name: 'HuyVuong',
          transferCode: 'A-HUY',
          active: true,
          createdAt: ''
        }
      ]
    };

    // 1. Quét QR ra TEST AHUY
    expect(service.findMatch('TEST AHUY', testServices, testMembers, mockGroups).matched).toBe(true);
    expect(service.findMatch('TEST AHUY', testServices, testMembers, mockGroups).member?.id).toBe('mem-huy');

    // 2. Quét QR ra AHUY
    expect(service.findMatch('AHUY', testServices, testMembers, mockGroups).matched).toBe(true);

    // 3. Nội dung thực tế từ VCB: "VCB 1017409054 TEST AHUY GD 12345"
    expect(service.findMatch('VCB 1017409054 TEST AHUY GD 12345', testServices, testMembers, mockGroups).matched).toBe(true);

    // 4. Dạng viết hoa thường có dấu gạch: "test a-huy"
    expect(service.findMatch('test a-huy', testServices, testMembers, mockGroups).matched).toBe(true);
  });
});

