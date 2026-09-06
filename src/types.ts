import { z } from 'zod';

// Thông tin người dùng đăng nhập hệ thống (Multi-User)
export interface User {
  id: string;               // usr_1788699...
  username: string;         // Duy nhất, chữ thường
  passwordHash: string;     // Bcrypt hash
  fullName?: string;        // Tên hiển thị (Họ tên)
  role: 'admin' | 'user';
  telegramChatId?: string;  // Chat ID Telegram cá nhân để nhận thông báo duyệt tiền
  sepayApiToken?: string;   // Token SePay riêng của người dùng
  sepayAutoSync?: boolean;  // Bật/tắt tự động đồng bộ SePay của người dùng
  createdAt: string;
  updatedAt: string;
}


// Mode đóng tiền: Chia đều hoặc Theo từng thành viên
export type ServicePaymentMode = 'shared' | 'per_member';

// Loại lịch nhắc: Định kỳ hàng tháng hoặc Thỉnh thoảng / Theo đợt phát sinh
export type ScheduleType = 'monthly' | 'on_demand';

// Thông tin ngân hàng nhận tiền
export interface BankAccountInfo {
  bankCode: string;       // Ví dụ: VCB, MB, TCB, VPB, TPB, ACB, TIMO, v.v.
  accountNumber: string;  // Số tài khoản ngân hàng
  accountName: string;    // Tên chủ tài khoản (in hoa không dấu)
}

// Thành viên tham gia dịch vụ
export interface Member {
  id: string;             // UUID
  name: string;           // Tên hiển thị (VD: Hoàng An)
  telegramUserId?: string; // Telegram User ID (để tag khi cần)
  telegramUsername?: string; // Telegram @username (VD: hoangan99)
  transferCode: string;   // Mã định danh chuyển khoản bất biến (VD: NET-AN)
  customAmount?: number;  // Số tiền riêng nếu mode là per_member (VNĐ)
  active: boolean;        // Còn tham gia hay không
  createdAt: string;
}

export type VerificationMode = 'sepay' | 'manual';

// Dịch vụ định kỳ hoặc Theo đợt
export interface Service {
  id: string;             // UUID
  userId?: string;        // Thuộc tài khoản người dùng nào (Multi-Tenant)
  groupId: string;        // Thuộc Telegram Group nào
  name: string;           // Tên dịch vụ (VD: Netflix Premium, Quỹ ăn uống, Tiền trọ...)
  description?: string;
  scheduleType: ScheduleType; // monthly (hàng tháng) | on_demand (thỉnh thoảng / theo đợt)
  verificationMode?: VerificationMode; // 'sepay' (tự động qua SePay) | 'manual' (duyệt 2 bước qua Telegram)
  reminderDay?: number;   // Ngày nhắc hàng tháng (1 - 28, chỉ cần nếu là monthly)
  reminderTime?: string;  // Giờ nhắc (HH:mm, mặc định 08:00)
  mode: ServicePaymentMode; // shared | per_member
  totalAmount: number;    // Tổng số tiền dịch vụ (VNĐ)
  defaultAmountPerMember?: number; // Số tiền mặc định mỗi người (nếu chia đều)
  transferPrefix?: string; // Tiền tố nội dung CK (VD: NET, SP, YT, ANUONG)
  collectorChatId?: string; // Telegram Chat ID của Người Thu Tiền / Duyệt Tiền riêng cho dịch vụ này
  bankInfo: BankAccountInfo;
  messageTemplate: string; // Mẫu tin nhắn nhắc kèm placeholder
  active: boolean;
  createdAt: string;
  updatedAt: string;
}


// Đợt thu tiền phát sinh hoặc theo kỳ (Sự kiện / Tiền ăn / Gói định kỳ)
export interface ExpenseBatchMemberItem {
  memberId: string;
  name: string;
  transferCode: string;
  telegramUsername?: string;
  amount: number;
  paidAmount?: number;
  status: 'paid' | 'unpaid' | 'pending_verify';
  paidAt?: string;
  transactionId?: string;
  qrMessageId?: number;    // ID tin nhắn ảnh QR riêng gửi trong nhóm (để xóa khi đã thanh toán)
  qrChatId?: string;       // Chat ID nơi gửi ảnh QR
}


export interface ExpenseBatch {
  id: string;
  userId?: string;        // Thuộc tài khoản người dùng nào
  serviceId: string;
  groupId: string;
  title: string;           // Tên đợt thu (VD: "Tiền ăn lẩu 06/09", "Vé xem phim", "Tháng 09/2026")
  batchType?: 'on_demand' | 'monthly';
  month?: string;          // YYYY-MM
  totalAmount: number;
  members: ExpenseBatchMemberItem[];
  messageId?: number;
  sentAt: string;
  status: 'active' | 'completed';
  completedAt?: string;
  completedNotificationSent?: boolean; // Đã gửi thông báo hoàn tất thu đủ 100% chưa
  note?: string;
}

// Nhóm Telegram
export interface Group {
  id: string;             // UUID
  userId?: string;        // Thuộc tài khoản người dùng nào
  chatId: string;         // Telegram Chat ID (VD: -1001234567890)
  title: string;          // Tên nhóm
  threadId?: number;      // Topic ID (nếu là nhóm có Topics)
  alertChatId?: string;   // Chat ID nhận cảnh báo giao dịch chưa khớp (mặc định chat chung hoặc admin)
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// Giao dịch từ Webhook (SePay / VietQR)
export interface Transaction {
  id: string;             // UUID hoặc SePay transaction id
  userId?: string;        // Thuộc tài khoản người dùng nào
  gateway: string;        // SePay, VietQR, MBBank, v.v.
  transactionDate: string; // Thời gian giao dịch
  accountNumber: string;  // Số tài khoản nhận
  amount: number;         // Số tiền nhận được
  content: string;        // Nội dung chuyển khoản thực tế
  code?: string;          // Mã code nếu có
  referenceCode?: string; // Mã tham chiếu ngân hàng
  matched: boolean;       // Đã khớp tự động chưa
  manualMatched?: boolean;// Đã gán thủ công chưa
  groupId?: string;
  serviceId?: string;
  memberId?: string;
  month?: string;         // Tháng đối soát (YYYY-MM)
  note?: string;
  rawPayload?: any;       // Lưu payload gốc phục vụ tra cứu
  createdAt: string;
}

// Receipt ghi nhận đã gửi thông báo nhắc định kỳ (chống gửi trùng lặp)
export interface ReminderReceipt {
  key: string;            // `groupId:serviceId:YYYY-MM`
  userId?: string;
  groupId: string;
  serviceId: string;
  month: string;          // YYYY-MM
  sentAt: string;
  messageId?: number;
  status: 'success' | 'failed';
  error?: string;
}

// Trạng thái đóng tiền của thành viên trong tháng
export interface MonthlyMemberPayment {
  memberId: string;
  serviceId: string;
  month: string;          // YYYY-MM
  expectedAmount: number;
  paidAmount: number;
  status: 'paid' | 'partial' | 'unpaid' | 'pending_verify';
  transactionIds: string[];
  paidAt?: string;
  qrMessageId?: number;
  qrChatId?: string;
}


// Toàn bộ State lưu trữ trong JSON
export interface AppState {
  version: number;
  users?: User[];             // Danh sách người dùng hệ thống (Multi-User)
  groups: Group[];
  services: Service[];
  members: Record<string, Member[]>; // serviceId -> Member[]
  transactions: Transaction[];
  reminderReceipts: ReminderReceipt[];
  monthlyPayments: MonthlyMemberPayment[];
  expenseBatches?: ExpenseBatch[]; // Các đợt thu tiền phát sinh
  adminPasswordHash?: string; // Băm mật khẩu admin mặc định
  sepayApiToken?: string;     // SePay User API Token
  sepayAutoSync?: boolean;    // Tự động đồng bộ giao dịch từ SePay định kỳ
  updatedAt: string;
}

// Zod validation schemas cho API
export const RegisterSchema = z.object({
  username: z.string().min(3, 'Tên đăng nhập phải có ít nhất 3 ký tự').max(30, 'Tên đăng nhập tối đa 30 ký tự').regex(/^[a-zA-Z0-9_]+$/, 'Tên đăng nhập chỉ gồm chữ cái, số và dấu gạch dưới'),
  password: z.string().min(6, 'Mật khẩu phải có ít nhất 6 ký tự'),
  fullName: z.string().optional()
});

export const LoginSchema = z.object({
  username: z.string().min(1, 'Vui lòng nhập tên đăng nhập'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu')
});

export const BankAccountInfoSchema = z.object({
  bankCode: z.string().min(2, 'Mã ngân hàng không hợp lệ'),
  accountNumber: z.string().min(4, 'Số tài khoản quá ngắn'),
  accountName: z.string().min(2, 'Tên chủ tài khoản không hợp lệ')
});

export const MemberSchema = z.object({
  name: z.string().min(1, 'Tên thành viên không được để trống'),
  telegramUserId: z.string().optional(),
  telegramUsername: z.string().optional(),
  transferCode: z.string().min(2, 'Mã chuyển khoản phải từ 2 ký tự').regex(/^[A-Za-z0-9_-]+$/, 'Mã chỉ gồm chữ, số, gạch nối'),
  customAmount: z.number().nonnegative().optional(),
  active: z.boolean().default(true)
});

export const ServiceSchema = z.object({
  groupId: z.string().min(1, 'Vui lòng chọn nhóm'),
  name: z.string().min(1, 'Tên dịch vụ không được để trống'),
  description: z.string().optional(),
  scheduleType: z.enum(['monthly', 'on_demand']).default('monthly'),
  verificationMode: z.enum(['sepay', 'manual']).default('manual').optional(),
  reminderDay: z.number().int().min(1).max(28, 'Ngày nhắc chỉ từ 1 đến 28 hàng tháng').optional().default(5),
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Định dạng giờ phải là HH:mm (VD: 08:30)').default('08:00').optional(),
  mode: z.enum(['shared', 'per_member']).default('shared').optional(),
  totalAmount: z.number().nonnegative('Tổng số tiền không được âm').default(0).optional(),
  defaultAmountPerMember: z.number().nonnegative().optional(),
  transferPrefix: z.string().default('').optional(),
  collectorChatId: z.string().optional(),
  bankInfo: BankAccountInfoSchema,
  messageTemplate: z.string().min(1, 'Mẫu tin nhắn không được để trống'),
  active: z.boolean().default(true)
});


export const GroupSchema = z.object({
  chatId: z.string().min(1, 'Chat ID Telegram không được để trống'),
  title: z.string().min(1, 'Tên nhóm không được để trống'),
  threadId: z.number().int().optional(),
  alertChatId: z.string().optional(),
  active: z.boolean().default(true)
});

