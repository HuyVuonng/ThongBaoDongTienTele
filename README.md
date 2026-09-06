# 🤖 Telegram Subscription Reminder & Auto Reconciliation Bot

Hệ thống Bot Telegram thông minh quản lý đa nhóm và đa dịch vụ định kỳ (Netflix, Spotify, Youtube Premium, iCloud, ChatGPT, quỹ nhóm, tiền nhà/điện nước...), tích hợp **mã VietQR động** tự điền số tiền và **tự động đối soát chuyển khoản ngân hàng qua Webhook SePay** kèm **Web Dashboard quản trị cao cấp**.

---

## ✨ Tính năng nổi bật

- 👥 **Đa nhóm & Đa dịch vụ**: Quản lý không giới hạn nhóm Telegram và các dịch vụ định kỳ. Hỗ trợ chia đều hoặc cấu hình số tiền riêng cho từng thành viên.
- ⏰ **Tự động nhắc nợ theo lịch**: `node-cron` quét lịch theo múi giờ `Asia/Ho_Chi_Minh` (ngày 1–28 hàng tháng), gửi tin nhắn định dạng đẹp kèm ảnh VietQR chuẩn NAPAS 247 vào nhóm Telegram.
- 🛡️ **Chống gửi trùng lặp**: Cơ chế khóa `groupId:serviceId:YYYY-MM` đảm bảo không bao giờ gửi lặp lại sau khi khởi động lại server.
- 💳 **Đối soát ngân hàng tự động (SePay Webhook)**:
  - Tự động nhận diện mã định danh bất biến của thành viên (VD: `NET-AN`, `SP-HUY`).
  - Cập nhật trạng thái "Đã đóng" ngay lập tức khi tiền về tài khoản.
  - Tự động gửi tin nhắn xác nhận vào nhóm Telegram: *"✅ Đã nhận 65.000đ từ Hoàng An cho dịch vụ Netflix"*.
  - Cảnh báo giao dịch chưa xác định đến Admin để gán thủ công.
- 🎨 **Web Dashboard Quản Trị Cao Cấp (Glassmorphism UI)**:
  - Thống kê tiến độ thu tiền tháng trực quan (% hoàn thành, tổng dự thu vs thực thu).
  - Quản lý CRUD Nhóm, Dịch vụ, Thành viên, Lịch sử giao dịch.
  - Xem trước tin nhắn & QR thời gian thực; nút **"Gửi thử vào nhóm ngay"** (Live Test).
  - Tích hợp sẵn **Bộ giả lập Webhook SePay (Simulator)** để test toàn bộ luồng đối soát trên giao diện mà không tốn tiền thật.
  - Sao lưu và phục hồi dữ liệu từ file JSON một chạm.
- 📦 **Lưu trữ JSON nguyên tử (Atomic Write)**: Không phụ thuộc cơ sở dữ liệu cồng kềnh, ghi file an toàn chống xung đột, tương thích hoàn hảo với **Render Persistent Disk**.

---

## 🚀 Hướng dẫn Cài đặt & Chạy Local

### 1. Yêu cầu hệ thống
- Node.js >= 18 (Khuyên dùng Node 20 hoặc 22)
- npm >= 9

### 2. Cài đặt mã nguồn
```bash
# Clone hoặc mở thư mục dự án
cd "telegram-subscription-bot"

# Cài đặt thư viện
npm install

# Tạo file cấu hình môi trường từ mẫu
cp .env.example .env
```

### 3. Cấu hình biến môi trường (`.env`)
Mở file `.env` và điền các thông tin:
```ini
PORT=3000
NODE_ENV=development

# Mật khẩu đăng nhập Web Dashboard
ADMIN_PASSWORD=admin123

# Chuỗi bí mật phiên đăng nhập
SESSION_SECRET=your_custom_secret_key_here

# Token Bot Telegram từ @BotFather (Để trống nếu muốn chạy thử nghiệm chế độ Mock)
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

# Telegram User ID của Admin (để nhận thông báo giao dịch lạ)
TELEGRAM_ADMIN_ID=123456789

# Secret Key Webhook SePay (Tùy chọn)
SEPAY_WEBHOOK_SECRET=

# Đường dẫn lưu trữ dữ liệu JSON
DATA_PATH=./data/state.json
TZ=Asia/Ho_Chi_Minh
```

### 4. Khởi chạy ứng dụng
```bash
# Chạy ở chế độ phát triển (Auto reload với tsx)
npm run dev

# Hoặc build và chạy production
npm run build
npm start
```

Mở trình duyệt và truy cập: **`http://localhost:3000`** (Mật khẩu mặc định: `admin123`).

---

## 🤖 Hướng dẫn Kết nối Telegram Bot & Lấy Chat ID

1. Mở Telegram, tìm bot **`@BotFather`** và gõ `/newbot` để tạo bot mới & lấy `BOT_TOKEN`.
2. Dán `BOT_TOKEN` vào file `.env` và khởi động lại server.
3. Thêm Bot vừa tạo vào nhóm Telegram cần nhắc tiền (Cấp quyền Admin hoặc quyền đọc tin nhắn cho bot).
4. Trong nhóm Telegram, gõ lệnh **`/chatid`** &rarr; Bot sẽ phản hồi mã **Chat ID** (VD: `-1001234567890`).
5. Truy cập Web Dashboard &rarr; Tab **Nhóm & Dịch vụ** &rarr; Bấm **"Thêm Nhóm Telegram"** &rarr; Dán Chat ID vào!

### Các lệnh Bot hỗ trợ trong nhóm:
- `/start` - Giới thiệu và hướng dẫn sử dụng.
- `/chatid` - Lấy Chat ID và Thread ID (Topic) của nhóm.
- `/status` - Xem bảng tổng hợp trạng thái đóng tiền của tất cả thành viên trong tháng này.
- `/help` - Hướng dẫn thành viên cú pháp chuyển khoản đúng.

---

## 💳 Cấu hình Webhook SePay

1. Đăng ký tài khoản tại [SePay.vn](https://sepay.vn) và liên kết tài khoản ngân hàng của bạn.
2. Vào mục **Cấu hình Webhook** trên SePay Dashboard:
   - **URL Webhook**: `https://your-domain.com/webhooks/sepay` (hoặc domain Render của bạn).
   - **Phương thức**: `POST`.
   - **Kiểu dữ liệu**: `JSON`.
3. Khi có bất kỳ ai chuyển khoản với nội dung chứa mã thành viên (VD: `NET-AN`), SePay sẽ bắn Webhook về hệ thống &rarr; Bot tự động đối soát và thông báo vào nhóm trong 3–10 giây!

---

## ☁️ Triển khai lên Render với Persistent Disk

Dự án đã tích hợp sẵn file `render.yaml` và `Dockerfile` chuẩn Production:

1. Đẩy mã nguồn lên GitHub/GitLab repository riêng của bạn.
2. Truy cập [Render.com](https://render.com) &rarr; Bấm **New** &rarr; Chọn **Blueprint**.
3. Chọn repo GitHub của dự án &rarr; Render sẽ tự động đọc `render.yaml` và thiết lập:
   - Web Service chạy bằng Docker.
   - Gắn **Persistent Disk** dung lượng 1GB tại `/var/data`.
   - Dữ liệu `state.json` được lưu tại `/var/data/state.json` (không bao giờ bị mất khi restart container).
4. Điền các biến môi trường (`BOT_TOKEN`, `ADMIN_PASSWORD`, `TELEGRAM_ADMIN_ID`, v.v.) trong mục Environment trên Render.
5. Deploy hoàn tất!

---

## 🧪 Chạy Kiểm Thử Tự Động (Unit Tests)

```bash
# Chạy toàn bộ test suites với Vitest
npm test
```

---

## 📂 Cấu trúc Thư mục

```
├── src/
│   ├── index.ts                 # Express Server, Scheduler & Graceful Shutdown
│   ├── config.ts                # Zod validate biến môi trường
│   ├── types.ts                 # TypeScript interfaces & Schemas
│   ├── store/
│   │   └── json-store.ts        # Atomic JSON persistence (Mutex + Temp Rename)
│   ├── providers/
│   │   ├── bank-provider.ts     # Abstract BankProvider
│   │   └── sepay.provider.ts    # VietQR Generator & SePay Webhook Parser
│   ├── bot/
│   │   └── telegram.ts          # grammY Telegram Bot & Message/Photo Sender
│   ├── services/
│   │   ├── reminder.service.ts  # Template rendering & Scheduled reminders
│   │   └── reconciliation.service.ts # Bank webhook matching & deduplication
│   ├── routes/
│   │   ├── auth.ts              # Login / Session / Password change
│   │   ├── api.ts               # Dashboard REST API (CRUD, Live Test, Simulator)
│   │   └── webhook.ts           # POST /webhooks/sepay
│   ├── views/
│   │   └── index.html           # Modern Glassmorphic SPA Dashboard
│   └── public/
│       ├── css/dashboard.css    # Premium CSS Design System
│       └── js/app.js            # Client reactive state & live QR previews
├── tests/                       # Unit tests for matching, templates, store
├── Dockerfile                   # Multi-stage production container
├── render.yaml                  # Render 1-click deploy blueprint
└── package.json
```

---

## 📄 Bản quyền & Giấy phép
Phát hành theo giấy phép MIT. Được thiết kế và xây dựng bởi Antigravity.
