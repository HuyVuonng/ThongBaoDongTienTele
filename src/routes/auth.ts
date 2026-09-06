import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { JsonStore } from '../store/json-store.js';
import { RegisterSchema, LoginSchema, User } from '../types.js';

export const authRouter = Router();
const store = JsonStore.getInstance();

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    username?: string;
    fullName?: string;
    role?: 'admin' | 'user';
    isAdmin?: boolean;
    loggedInAt?: string;
  }
}

/**
 * Đảm bảo tài khoản Admin mặc định tồn tại và gán dữ liệu cũ chưa có userId
 */
async function ensureAdminUser(): Promise<User> {
  const state = await store.read();
  if (!state.users) {
    state.users = [];
  }

  let admin = state.users.find(u => u.username === 'admin');
  if (!admin) {
    const passwordHash = state.adminPasswordHash || await bcrypt.hash(config.ADMIN_PASSWORD, 10);
    admin = {
      id: 'usr_admin',
      username: 'admin',
      passwordHash,
      fullName: 'Quản Trị Viên',
      role: 'admin',
      sepayApiToken: state.sepayApiToken,
      sepayAutoSync: state.sepayAutoSync ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.users.unshift(admin);

    // Gán userId cho các nhóm, dịch vụ cũ nếu chưa có
    for (const g of state.groups) {
      if (!g.userId) g.userId = admin.id;
    }
    for (const s of state.services) {
      if (!s.userId) s.userId = admin.id;
    }
    for (const b of (state.expenseBatches || [])) {
      if (!b.userId) b.userId = admin.id;
    }
    for (const t of state.transactions) {
      if (!t.userId) t.userId = admin.id;
    }

    await store.update(s => {
      s.users = state.users;
      s.groups = state.groups;
      s.services = state.services;
      s.expenseBatches = state.expenseBatches;
      s.transactions = state.transactions;
    });
  }

  return admin;
}

export { ensureAdminUser };


/**
 * Middleware bảo vệ các API Dashboard yêu cầu đăng nhập
 */
export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (req.session && (req.session.userId || req.session.isAdmin)) {
    // Tự động gán userId nếu là legacy session
    if (!req.session.userId) {
      const admin = await ensureAdminUser();
      req.session.userId = admin.id;
      req.session.username = admin.username;
      req.session.fullName = admin.fullName;
      req.session.role = admin.role;
    }
    next();
  } else {
    res.status(401).json({ success: false, error: 'Chưa đăng nhập hoặc phiên làm việc đã hết hạn' });
  }
};

/**
 * Middleware chỉ cho phép tài khoản Admin thực thi
 */
export const requireAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (req.session && (req.session.role === 'admin' || req.session.isAdmin || req.session.username === 'admin')) {
    next();
  } else {
    res.status(403).json({ success: false, error: 'Chỉ Quản trị viên (Admin) mới có quyền thực hiện thao tác này.' });
  }
};


/**
 * POST /api/auth/register - Đăng ký tài khoản người dùng mới
 */
authRouter.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const validated = RegisterSchema.parse(req.body);
    const cleanUsername = validated.username.toLowerCase().trim();

    await ensureAdminUser();
    const state = await store.read();
    const existing = (state.users || []).find(u => u.username.toLowerCase() === cleanUsername);

    if (existing) {
      res.status(400).json({ success: false, error: 'Tên đăng nhập này đã tồn tại. Vui lòng chọn tên khác.' });
      return;
    }

    const passwordHash = await bcrypt.hash(validated.password, 10);
    const isFirst = (state.users || []).length === 0;

    const newUser: User = {
      id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      username: cleanUsername,
      passwordHash,
      fullName: (validated.fullName || cleanUsername).trim(),
      role: isFirst ? 'admin' : 'user',
      sepayAutoSync: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await store.update(s => {
      if (!s.users) s.users = [];
      s.users.push(newUser);
    });

    // Tự động đăng nhập
    req.session.userId = newUser.id;
    req.session.username = newUser.username;
    req.session.fullName = newUser.fullName;
    req.session.role = newUser.role;
    req.session.isAdmin = newUser.role === 'admin';
    req.session.loggedInAt = new Date().toISOString();

    res.json({
      success: true,
      message: 'Đăng ký tài khoản thành công!',
      user: {
        id: newUser.id,
        username: newUser.username,
        fullName: newUser.fullName,
        role: newUser.role
      }
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message || 'Dữ liệu đăng ký không hợp lệ' });
  }
});

/**
 * POST /api/auth/login - Đăng nhập tài khoản
 */
authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!password) {
      res.status(400).json({ success: false, error: 'Vui lòng nhập mật khẩu' });
      return;
    }

    await ensureAdminUser();
    const state = await store.read();
    const users = state.users || [];

    let matchedUser: User | undefined;

    if (username && typeof username === 'string') {
      const cleanUsername = username.toLowerCase().trim();
      matchedUser = users.find(u => u.username.toLowerCase() === cleanUsername);
    } else {
      // Fallback: nếu chỉ nhập password thì thử so khớp với admin
      matchedUser = users.find(u => u.role === 'admin') || users[0];
    }

    if (!matchedUser) {
      res.status(401).json({ success: false, error: 'Tài khoản không tồn tại' });
      return;
    }

    const isValid = await bcrypt.compare(password, matchedUser.passwordHash);
    if (!isValid) {
      res.status(401).json({ success: false, error: 'Mật khẩu không chính xác' });
      return;
    }

    req.session.userId = matchedUser.id;
    req.session.username = matchedUser.username;
    req.session.fullName = matchedUser.fullName;
    req.session.role = matchedUser.role;
    req.session.isAdmin = matchedUser.role === 'admin';
    req.session.loggedInAt = new Date().toISOString();

    res.json({
      success: true,
      message: 'Đăng nhập thành công',
      user: {
        id: matchedUser.id,
        username: matchedUser.username,
        fullName: matchedUser.fullName,
        role: matchedUser.role
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/auth/logout
 */
authRouter.post('/logout', (req: Request, res: Response): void => {
  req.session.destroy(err => {
    if (err) {
      res.status(500).json({ success: false, error: 'Không thể đăng xuất' });
      return;
    }
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'Đã đăng xuất' });
  });
});

/**
 * GET /api/auth/check
 */
authRouter.get('/check', async (req: Request, res: Response): Promise<void> => {
  if (req.session && (req.session.userId || req.session.isAdmin)) {
    if (!req.session.userId) {
      const admin = await ensureAdminUser();
      req.session.userId = admin.id;
      req.session.username = admin.username;
      req.session.fullName = admin.fullName;
      req.session.role = admin.role;
    }

    res.json({
      authenticated: true,
      user: {
        id: req.session.userId,
        username: req.session.username,
        fullName: req.session.fullName || req.session.username,
        role: req.session.role || 'user'
      }
    });
  } else {
    res.json({
      authenticated: false,
      user: null
    });
  }
});

/**
 * POST /api/auth/change-password
 */
authRouter.post('/change-password', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword || newPassword.length < 6) {
    res.status(400).json({ success: false, error: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
    return;
  }

  const userId = req.session.userId!;
  const state = await store.read();
  const user = (state.users || []).find(u => u.id === userId);

  if (!user) {
    res.status(404).json({ success: false, error: 'Người dùng không tồn tại' });
    return;
  }

  const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isCurrentValid) {
    res.status(400).json({ success: false, error: 'Mật khẩu hiện tại không đúng' });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await store.update(s => {
    const u = (s.users || []).find(usr => usr.id === userId);
    if (u) {
      u.passwordHash = newHash;
      u.updatedAt = new Date().toISOString();
    }
  });

  res.json({ success: true, message: 'Đổi mật khẩu thành công' });
});
