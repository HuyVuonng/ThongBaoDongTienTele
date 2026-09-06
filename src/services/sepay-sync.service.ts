import { JsonStore } from '../store/json-store.js';
import { config } from '../config.js';
import { ReconciliationService } from './reconciliation.service.js';

export interface SepayTransactionItem {
  id: number | string;
  bank_brand_name?: string;
  account_number?: string;
  transaction_date?: string;
  amount_in?: string | number;
  amount_out?: string | number;
  accumulated?: string | number;
  transaction_content?: string;
  reference_number?: string;
  code?: string | null;
  sub_account?: string | null;
}

export interface SepayBankAccount {
  id?: string | number;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  active: boolean;
}

export interface SepayQuotaInfo {
  planName: string;
  monthlyLimit: number;
  usedThisMonth: number;
  remaining: number;
  usagePercent: number;
  month: string;
}

export class SepaySyncService {
  private static instance: SepaySyncService;
  private store: JsonStore;
  private reconciliationService: ReconciliationService;
  private pollTimer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private lastSyncedAt: string | null = null;

  private constructor() {
    this.store = JsonStore.getInstance();
    this.reconciliationService = ReconciliationService.getInstance();
  }

  public static getInstance(): SepaySyncService {
    if (!SepaySyncService.instance) {
      SepaySyncService.instance = new SepaySyncService();
    }
    return SepaySyncService.instance;
  }

  /**
   * Lấy danh sách giao dịch từ SePay User API (Thử v2 rồi fallback sang v1)
   */
  public async fetchTransactionsFromApi(apiToken: string, limit = 100): Promise<SepayTransactionItem[]> {
    const cleanToken = apiToken.trim();
    if (!cleanToken) throw new Error('API Token không được để trống');

    // Thử SePay API v2 trước
    try {
      const v2Url = `https://userapi.sepay.vn/v2/transactions?limit=${limit}`;
      const v2Res = await fetch(v2Url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (v2Res.ok) {
        const data: any = await v2Res.json();
        if (data && Array.isArray(data.transactions)) {
          return data.transactions.map((t: any) => ({
            id: t.id || t.xid || t.reference_number,
            bank_brand_name: t.bank_short_name || t.bank_brand_name || 'SePay',
            account_number: t.account_number,
            transaction_date: t.transaction_date,
            amount_in: t.amount_in,
            amount_out: t.amount_out,
            accumulated: t.accumulated,
            transaction_content: t.transaction_content,
            reference_number: t.reference_number,
            code: t.code,
            sub_account: t.sub_account
          }));
        }
      }
    } catch (v2Err) {
      // Bỏ qua và thử v1
    }

    // Fallback sang SePay v1 legacy
    const url = `https://my.sepay.vn/userapi/transactions/list?limit=${limit}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Lỗi từ SePay API (${response.status}): ${errorText || response.statusText}`);
    }

    const data: any = await response.json();
    if (data.status && data.status !== 200 && data.messages) {
      throw new Error(`SePay trả về lỗi: ${data.messages}`);
    }

    return (data.transactions || []) as SepayTransactionItem[];
  }

  /**
   * Lấy danh sách tài khoản ngân hàng đã liên kết trên SePay
   */
  public async fetchBankAccounts(apiToken: string): Promise<SepayBankAccount[]> {
    const cleanToken = apiToken.trim();
    if (!cleanToken) return [];

    const accounts: SepayBankAccount[] = [];

    // 1. Thử gọi endpoint Bank Accounts v2
    try {
      const v2Url = `https://userapi.sepay.vn/v2/bank-accounts`;
      const res = await fetch(v2Url, {
        headers: { 'Authorization': `Bearer ${cleanToken}` }
      });
      if (res.ok) {
        const data: any = await res.json();
        const list = Array.isArray(data) ? data : data.bank_accounts || data.data || [];
        for (const item of list) {
          if (item.account_number) {
            accounts.push({
              id: item.id || item.xid,
              bankCode: (item.bank_short_name || item.bank_brand_name || 'BANK').toUpperCase(),
              bankName: item.bank_name || item.bank_short_name || 'Ngân hàng',
              accountNumber: item.account_number,
              accountName: (item.account_holder_name || item.account_name || 'Chủ tài khoản').toUpperCase(),
              active: item.active !== false
            });
          }
        }
      }
    } catch (e) {}

    // 2. Nếu không lấy được qua v2, thử endpoint v1
    if (accounts.length === 0) {
      try {
        const v1Url = `https://my.sepay.vn/userapi/bank-accounts/list`;
        const res = await fetch(v1Url, {
          headers: { 'Authorization': `Bearer ${cleanToken}` }
        });
        if (res.ok) {
          const data: any = await res.json();
          const list = data.bank_accounts || data.data || [];
          for (const item of list) {
            if (item.account_number) {
              accounts.push({
                id: item.id,
                bankCode: (item.bank_brand_name || 'BANK').toUpperCase(),
                bankName: item.bank_brand_name || 'Ngân hàng',
                accountNumber: item.account_number,
                accountName: (item.account_name || 'Chủ tài khoản').toUpperCase(),
                active: true
              });
            }
          }
        }
      } catch (e) {}
    }

    // 3. Nếu vẫn chưa có danh sách, tự động suy ra từ các giao dịch gần nhất
    if (accounts.length === 0) {
      try {
        const txList = await this.fetchTransactionsFromApi(cleanToken, 20);
        const seen = new Set<string>();
        for (const tx of txList) {
          if (tx.account_number && !seen.has(tx.account_number)) {
            seen.add(tx.account_number);
            accounts.push({
              bankCode: (tx.bank_brand_name || 'BANK').toUpperCase(),
              bankName: tx.bank_brand_name || 'Ngân hàng liên kết SePay',
              accountNumber: tx.account_number,
              accountName: 'TÀI KHOẢN SEPAY',
              active: true
            });
          }
        }
      } catch (e) {}
    }

    return accounts;
  }

  /**
   * Tính toán thống kê hạn mức giao dịch trong tháng của SePay
   */
  public async fetchQuotaAndStats(apiToken: string): Promise<SepayQuotaInfo> {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const displayMonth = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    let usedThisMonth = 0;
    const monthlyLimit = 50; // Hạn mức gói Free mặc định của SePay

    try {
      const txs = await this.fetchTransactionsFromApi(apiToken, 100);
      usedThisMonth = txs.filter(t => {
        if (!t.transaction_date) return false;
        return t.transaction_date.startsWith(currentMonthKey);
      }).length;
    } catch (e) {
      // Nếu lỗi fetch, dùng số lượng giao dịch đã lưu trong state của tháng này
      const state = await this.store.read();
      usedThisMonth = (state.transactions || []).filter(t => (t.month === currentMonthKey || t.transactionDate.startsWith(currentMonthKey))).length;
    }

    const remaining = Math.max(0, monthlyLimit - usedThisMonth);
    const usagePercent = Math.min(100, Math.round((usedThisMonth / monthlyLimit) * 100));
    const planName = usedThisMonth > monthlyLimit ? 'Gói Nâng Cao' : 'Gói Miễn Phí (Free 0đ)';

    return {
      planName,
      monthlyLimit,
      usedThisMonth,
      remaining,
      usagePercent,
      month: displayMonth
    };
  }

  /**
   * Lấy toàn bộ thông tin trạng thái, ngân hàng & hạn mức SePay của người dùng
   */
  public async getDetailedStatus(userId?: string): Promise<{
    configured: boolean;
    maskedToken: string;
    autoSync: boolean;
    lastSyncedAt: string | null;
    bankAccounts: SepayBankAccount[];
    quota: SepayQuotaInfo;
    error?: string;
  }> {
    const state = await this.store.read();
    const currentUser = (state.users || []).find(u => u.id === userId);
    const token = (currentUser?.sepayApiToken || state.sepayApiToken || config.SEPAY_WEBHOOK_SECRET || process.env.SEPAY_API_TOKEN || '').trim();
    const autoSync = currentUser?.sepayAutoSync ?? state.sepayAutoSync ?? true;

    const displayMonth = `${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}`;

    if (!token) {
      return {
        configured: false,
        maskedToken: '',
        autoSync,
        lastSyncedAt: this.lastSyncedAt,
        bankAccounts: [],
        quota: {
          planName: 'Gói Miễn Phí (Free 0đ)',
          monthlyLimit: 50,
          usedThisMonth: 0,
          remaining: 50,
          usagePercent: 0,
          month: displayMonth
        }
      };
    }

    const maskedToken = token.length > 8 ? `${token.substring(0, 4)}...${token.substring(token.length - 4)}` : '****';

    try {
      const [bankAccounts, quota] = await Promise.all([
        this.fetchBankAccounts(token),
        this.fetchQuotaAndStats(token)
      ]);

      return {
        configured: true,
        maskedToken,
        autoSync,
        lastSyncedAt: this.lastSyncedAt || new Date().toISOString(),
        bankAccounts,
        quota
      };
    } catch (err: any) {
      return {
        configured: true,
        maskedToken,
        autoSync,
        lastSyncedAt: this.lastSyncedAt,
        bankAccounts: [],
        quota: {
          planName: 'Gói Miễn Phí (Free 0đ)',
          monthlyLimit: 50,
          usedThisMonth: 0,
          remaining: 50,
          usagePercent: 0,
          month: displayMonth
        },
        error: err.message || 'Không thể kết nối SePay API'
      };
    }
  }

  /**
   * Áp dụng tài khoản ngân hàng đã chọn vào toàn bộ các Dịch vụ của người dùng
   */
  public async applyBankAccountToAllServices(
    bankInfo: {
      bankCode: string;
      accountNumber: string;
      accountName: string;
    },
    userId?: string
  ): Promise<{ updatedCount: number }> {
    let updatedCount = 0;
    await this.store.update(state => {
      for (const svc of state.services) {
        if (!userId || svc.userId === userId || (!svc.userId && userId === 'usr_admin')) {
          svc.bankInfo = {
            bankCode: bankInfo.bankCode.toUpperCase().trim(),
            accountNumber: bankInfo.accountNumber.trim(),
            accountName: bankInfo.accountName.toUpperCase().trim()
          };
          svc.updatedAt = new Date().toISOString();
          updatedCount++;
        }
      }
    });
    return { updatedCount };
  }

  /**
   * Đồng bộ giao dịch từ SePay vào hệ thống đối soát
   */
  public async syncTransactions(customToken?: string, userId?: string): Promise<{
    success: boolean;
    totalFetched: number;
    newProcessed: number;
    matchedCount: number;
    duplicateCount: number;
    error?: string;
  }> {
    try {
      const state = await this.store.read();
      const currentUser = (state.users || []).find(u => u.id === userId);
      const token = customToken || currentUser?.sepayApiToken || state.sepayApiToken || config.SEPAY_WEBHOOK_SECRET || process.env.SEPAY_API_TOKEN || '';

      if (!token) {
        return {
          success: false,
          totalFetched: 0,
          newProcessed: 0,
          matchedCount: 0,
          duplicateCount: 0,
          error: 'Chưa cấu hình SePay API Token. Vui lòng nhập token tại Cài đặt hoặc file .env'
        };
      }

      const rawTransactions = await this.fetchTransactionsFromApi(token);
      let newProcessed = 0;
      let matchedCount = 0;
      let duplicateCount = 0;

      // Xử lý theo thứ tự thời gian tăng dần (từ cũ đến mới)
      const sortedTransactions = [...rawTransactions].reverse();

      for (const item of sortedTransactions) {
        const amountIn = typeof item.amount_in === 'string' ? parseFloat(item.amount_in) : Number(item.amount_in || 0);
        if (isNaN(amountIn) || amountIn <= 0) continue; // Chỉ xử lý tiền vào

        const txId = String(item.id || item.reference_number || `sepay_${Date.now()}`);
        const content = String(item.transaction_content || '').trim();
        const accountNumber = String(item.account_number || '').trim();
        const transactionDate = item.transaction_date || new Date().toISOString();

        const result = await this.reconciliationService.processTransaction({
          id: txId,
          gateway: item.bank_brand_name || 'SePay',
          transactionDate,
          accountNumber,
          amount: amountIn,
          content,
          code: item.code || undefined,
          referenceCode: item.reference_number || undefined,
          rawPayload: item
        });

        if (result.isDuplicate) {
          duplicateCount++;
        } else {
          newProcessed++;
          if (result.matched) matchedCount++;
          // Gán userId cho transaction nếu chưa có
          if (userId && result.transaction && !result.transaction.userId) {
            await this.store.update(s => {
              const tx = s.transactions.find(t => t.id === txId);
              if (tx) tx.userId = userId;
            });
          }
        }
      }

      this.lastSyncedAt = new Date().toISOString();

      return {
        success: true,
        totalFetched: rawTransactions.length,
        newProcessed,
        matchedCount,
        duplicateCount
      };
    } catch (err: any) {
      console.error('❌ Lỗi khi đồng bộ SePay API:', err);
      return {
        success: false,
        totalFetched: 0,
        newProcessed: 0,
        matchedCount: 0,
        duplicateCount: 0,
        error: err?.message || 'Lỗi kết nối tới SePay'
      };
    }
  }

  /**
   * Khởi động chạy nền tự động polling định kỳ nếu được bật
   */
  public startPolling(intervalMs = 20000): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.pollTimer = setInterval(async () => {
      if (this.isPolling) return;
      this.isPolling = true;
      try {
        const state = await this.store.read();
        
        // Quét cho tất cả user có cấu hình SePay
        const usersToSync = (state.users || []).filter(u => u.sepayApiToken && u.sepayAutoSync !== false);

        if (usersToSync.length > 0) {
          for (const u of usersToSync) {
            try {
              const res = await this.syncTransactions(u.sepayApiToken, u.id);
              if (res.newProcessed > 0) {
                console.log(`⚡ [SePay Auto-Sync - User ${u.username}] Đã đồng bộ ${res.newProcessed} giao dịch mới (${res.matchedCount} khớp tự động).`);
              }
            } catch (uErr) {}
          }
        } else if (state.sepayApiToken && (state.sepayAutoSync ?? true)) {
          // Fallback legacy global config
          const res = await this.syncTransactions();
          if (res.newProcessed > 0) {
            console.log(`⚡ [SePay Auto-Sync] Đã đồng bộ ${res.newProcessed} giao dịch mới (${res.matchedCount} khớp tự động).`);
          }
        }
      } catch (err) {
        // Im lặng khi poll nền
      } finally {
        this.isPolling = false;
      }
    }, intervalMs);

    console.log(`🔄 SePay Auto-Sync Poller đã được kích hoạt (chu kỳ ${Math.round(intervalMs / 1000)}s).`);
  }

  public stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
