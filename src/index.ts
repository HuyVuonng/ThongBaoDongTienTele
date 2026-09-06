import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { JsonStore } from './store/json-store.js';
import { TelegramBotService } from './bot/telegram.js';
import { ReminderService } from './services/reminder.service.js';
import { SepaySyncService } from './services/sepay-sync.service.js';
import { authRouter } from './routes/auth.js';
import { apiRouter } from './routes/api.js';
import { webhookRouter } from './routes/webhook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function bootstrap() {
  console.log('🚀 Đang khởi động Telegram Subscription Reminder System...');

  // 1. Khởi tạo Store
  const store = JsonStore.getInstance();
  await store.init();
  console.log(`📦 State store đã sẵn sàng tại: ${config.resolvedDataPath}`);

  // 2. Khởi tạo Telegram Bot
  const telegram = TelegramBotService.getInstance();
  await telegram.start();

  // 3. Khởi tạo Reminder Service & Cron Scheduler
  const reminderService = ReminderService.getInstance();
  
  // Lịch quét tự động mỗi phút (đảm bảo bắn đúng chính xác từng phút theo giờ nhắc hẹn trước của dịch vụ)
  cron.schedule('* * * * *', async () => {
    try {
      const result = await reminderService.checkAndSendReminders(new Date(), false);
      if (result.sentCount > 0) {
        console.log(`⏰ [CRON RUNNER] Đã gửi tự động ${result.sentCount} thông báo nhắc nợ.`);
      }
    } catch (err) {
      console.error('❌ [CRON ERROR]:', err);
    }
  }, {
    timezone: config.TZ
  });

  // Lịch tự động dọn dẹp các đợt thu tiền đã hoàn tất quá 7 ngày (chạy mỗi giờ)
  cron.schedule('0 * * * *', async () => {
    try {
      await reminderService.cleanupCompletedBatches(7);
    } catch (err) {
      console.error('❌ [CLEANUP CRON ERROR]:', err);
    }
  }, {
    timezone: config.TZ
  });

  // Chạy dọn dẹp đợt thu cũ ngay khi khởi động
  reminderService.cleanupCompletedBatches(7).catch(() => {});

  console.log(`⏰ Cron Scheduler & Auto-Cleanup (7 ngày) đã kích hoạt (Timezone: ${config.TZ})`);

  // Khởi tạo SePay Sync Poller (Tự động đồng bộ giao dịch từ SePay)
  const sepaySync = SepaySyncService.getInstance();
  sepaySync.startPolling(20000); // Poll mỗi 20s nếu được cấu hình


  // 4. Khởi tạo Express App
  const app = express();

  // Trust proxy khi chạy trên Render/Reverse Proxy
  if (config.isProd) {
    app.set('trust proxy', 1);
  }

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  app.use(
    session({
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true, // Tự động gia hạn thêm 1 tiếng mỗi khi người dùng thao tác
      cookie: {
        httpOnly: true,
        secure: config.isProd,
        sameSite: 'lax',
        maxAge: 60 * 60 * 1000 // 1 tiếng (3.600.000 ms)
      }
    })
  );

  // Serve static files
  const publicDir = fs.existsSync(path.resolve(__dirname, 'public'))
    ? path.resolve(__dirname, 'public')
    : path.resolve(process.cwd(), 'src', 'public');
  const viewsDir = fs.existsSync(path.resolve(__dirname, 'views'))
    ? path.resolve(__dirname, 'views')
    : path.resolve(process.cwd(), 'src', 'views');
  app.use(express.static(publicDir));

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  });

  // Mount API Routers
  app.use('/api/auth', authRouter);
  app.use('/api', apiRouter);
  app.use('/webhooks', webhookRouter);

  // Serve Web Dashboard Frontend
  app.get('*', (req, res) => {
    res.sendFile(path.join(viewsDir, 'index.html'));
  });

  // Start HTTP Server
  const server = app.listen(config.PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🎉 Web Dashboard đang chạy tại: http://localhost:${config.PORT}`);
    console.log(`🔗 Webhook SePay endpoint: http://localhost:${config.PORT}/webhooks/sepay`);
    console.log(`======================================================\n`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Nhận tín hiệu ${signal}, đang tắt server an toàn...`);
    await telegram.stop();
    server.close(() => {
      console.log('✅ HTTP Server đã dừng.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch(err => {
  console.error('❌ Lỗi khởi động ứng dụng:', err);
  process.exit(1);
});
