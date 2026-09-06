import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  ADMIN_PASSWORD: z.string().min(6, 'Mật khẩu admin tối thiểu 6 ký tự').default('admin123'),
  SESSION_SECRET: z.string().default('default_session_secret_key_antigravity_12345'),
  BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_ADMIN_ID: z.string().optional().default(''),
  SEPAY_WEBHOOK_SECRET: z.string().optional().default(''),
  SEPAY_API_TOKEN: z.string().optional().default(''),
  DATA_PATH: z.string().default('./data/state.json'),
  TZ: z.string().default('Asia/Ho_Chi_Minh'),
  PUBLIC_URL: z.string().optional().default('')
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Lỗi cấu hình biến môi trường (.env):', parsed.error.format());
  process.exit(1);
}

export const config = {
  ...parsed.data,
  resolvedDataPath: path.resolve(process.cwd(), parsed.data.DATA_PATH),
  dataDir: path.dirname(path.resolve(process.cwd(), parsed.data.DATA_PATH)),
  isDev: parsed.data.NODE_ENV === 'development',
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test'
};
