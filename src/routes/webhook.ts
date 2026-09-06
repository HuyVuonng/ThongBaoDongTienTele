import { Router, Request, Response } from 'express';
import { SepayProvider } from '../providers/sepay.provider.js';
import { ReconciliationService } from '../services/reconciliation.service.js';

export const webhookRouter = Router();
const sepayProvider = new SepayProvider();
const reconciliationService = ReconciliationService.getInstance();

/**
 * POST /webhooks/sepay
 * Endpoint nhận webhook biến động số dư từ SePay
 */
webhookRouter.post('/sepay', async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = sepayProvider.parseWebhook(req.headers, req.body);

    if (!parseResult.isValid || !parseResult.transaction) {
      console.warn('⚠️ Webhook SePay không hợp lệ:', parseResult.error);
      // Vẫn trả về 200/400 kèm message để tránh SePay retry liên tục nếu là lỗi payload định dạng sai
      res.status(200).json({
        success: false,
        message: parseResult.error || 'Bỏ qua giao dịch không hợp lệ'
      });
      return;
    }

    const { matched, isDuplicate, transaction } = await reconciliationService.processTransaction(parseResult.transaction);

    res.status(200).json({
      success: true,
      message: isDuplicate ? 'Giao dịch đã tồn tại' : (matched ? 'Đối soát thành công' : 'Đã ghi nhận giao dịch chưa khớp'),
      transactionId: transaction.id,
      matched,
      isDuplicate
    });
  } catch (error: any) {
    console.error('❌ Lỗi xử lý Webhook SePay:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Lỗi máy chủ nội bộ khi xử lý webhook'
    });
  }
});
