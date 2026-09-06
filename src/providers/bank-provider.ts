import { BankAccountInfo, Transaction } from '../types.js';

export interface ParsedWebhookResult {
  isValid: boolean;
  error?: string;
  transaction?: {
    id: string;
    gateway: string;
    transactionDate: string;
    accountNumber: string;
    amount: number;
    content: string;
    code?: string;
    referenceCode?: string;
    rawPayload: any;
  };
}

export interface GenerateQRParams {
  bankInfo: BankAccountInfo;
  amount?: number;
  description: string;
  template?: 'compact' | 'compact2' | 'qr_only' | 'print';
}

export interface BankProvider {
  readonly name: string;

  /**
   * Tạo URL ảnh VietQR chuẩn NAPAS 247
   */
  generateQRUrl(params: GenerateQRParams): string;

  /**
   * Xác thực và phân tích payload Webhook từ ngân hàng / trung gian
   */
  parseWebhook(headers: Record<string, any>, body: any): ParsedWebhookResult;
}
