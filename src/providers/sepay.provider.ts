import { BankProvider, GenerateQRParams, ParsedWebhookResult } from './bank-provider.js';
import { config } from '../config.js';

export class SepayProvider implements BankProvider {
  public readonly name = 'SePay';

  /**
   * Tạo đường dẫn ảnh VietQR động chuẩn VietQR.io
   * Định dạng: https://img.vietqr.io/image/<BANK_ID>-<ACCOUNT_NO>-<TEMPLATE>.png?amount=<AMOUNT>&addInfo=<INFO>&accountName=<NAME>
   */
  public generateQRUrl(params: GenerateQRParams): string {
    const { bankInfo, amount, description, template = 'compact2' } = params;
    
    // Chuẩn hóa mã ngân hàng và số tài khoản
    const bankCode = encodeURIComponent(bankInfo.bankCode.trim().toUpperCase());
    const accountNo = encodeURIComponent(bankInfo.accountNumber.trim().replace(/\s+/g, ''));
    
    let url = `https://img.vietqr.io/image/${bankCode}-${accountNo}-${template}.png`;
    
    const queryParams: string[] = [];
    
    if (amount && amount > 0) {
      queryParams.push(`amount=${Math.round(amount)}`);
    }
    
    if (description) {
      // Cắt ngắn nếu quá dài theo chuẩn Napas (< 50 ký tự)
      const cleanDesc = description.trim().substring(0, 50);
      queryParams.push(`addInfo=${encodeURIComponent(cleanDesc)}`);
    }
    
    if (bankInfo.accountName) {
      queryParams.push(`accountName=${encodeURIComponent(bankInfo.accountName.trim().toUpperCase())}`);
    }

    if (queryParams.length > 0) {
      url += `?${queryParams.join('&')}`;
    }

    return url;
  }

  /**
   * Phân tích và kiểm tra xác thực Webhook SePay
   */
  public parseWebhook(headers: Record<string, any>, body: any): ParsedWebhookResult {
    // 1. Kiểm tra xác thực SePay Secret (nếu cấu hình)
    if (config.SEPAY_WEBHOOK_SECRET) {
      const authHeader = (headers['authorization'] || headers['Authorization'] || '') as string;
      const customSecretHeader = (headers['x-sepay-secret'] || headers['x-api-key'] || '') as string;
      
      const expectedApiKey = `Apikey ${config.SEPAY_WEBHOOK_SECRET}`;
      const isAuthValid = 
        authHeader === expectedApiKey ||
        authHeader === config.SEPAY_WEBHOOK_SECRET ||
        customSecretHeader === config.SEPAY_WEBHOOK_SECRET;

      if (!isAuthValid) {
        return {
          isValid: false,
          error: 'Xác thực Webhook không hợp lệ: Sai Authorization API Key hoặc Secret Token'
        };
      }
    }

    // 2. Validate cấu trúc payload SePay
    if (!body || typeof body !== 'object') {
      return {
        isValid: false,
        error: 'Payload rỗng hoặc không đúng định dạng JSON'
      };
    }

    // SePay có trường `transferType` (in | out) hoặc kiểm tra `transferAmount`
    const transferType = body.transferType || (body.transferAmount && body.transferAmount > 0 ? 'in' : 'unknown');
    if (transferType !== 'in') {
      return {
        isValid: false,
        error: `Bỏ qua giao dịch không phải tiền vào (transferType: ${transferType})`
      };
    }

    const transactionId = String(body.id || body.referenceCode || `tx_${Date.now()}`);
    const amount = Number(body.transferAmount || body.amount || 0);

    if (isNaN(amount) || amount <= 0) {
      return {
        isValid: false,
        error: 'Số tiền giao dịch không hợp lệ'
      };
    }

    const content = String(body.content || body.description || '').trim();
    const accountNumber = String(body.accountNumber || body.subAccount || '').trim();
    const transactionDate = body.transactionDate || new Date().toISOString();

    return {
      isValid: true,
      transaction: {
        id: transactionId,
        gateway: body.gateway || 'SePay',
        transactionDate,
        accountNumber,
        amount,
        content,
        code: body.code ? String(body.code) : undefined,
        referenceCode: body.referenceCode ? String(body.referenceCode) : undefined,
        rawPayload: body
      }
    };
  }
}
