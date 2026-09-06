import fs from 'fs';
import path from 'path';
import { AppState, Group, Service, Member, Transaction, ReminderReceipt, MonthlyMemberPayment } from '../types.js';
import { config } from '../config.js';

export class JsonStore {
  private static instance: JsonStore;
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private cache: AppState | null = null;

  private constructor() {
    this.filePath = config.resolvedDataPath;
  }

  public static getInstance(): JsonStore {
    if (!JsonStore.instance) {
      JsonStore.instance = new JsonStore();
    }
    return JsonStore.instance;
  }

  /**
   * Khởi tạo store: Đảm bảo thư mục tồn tại và nạp file JSON
   */
  public async init(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.filePath)) {
      // Nếu chưa có file state.json, thử copy từ state.example.json hoặc tạo mới
      const examplePath = path.resolve(process.cwd(), 'data/state.example.json');
      if (fs.existsSync(examplePath)) {
        try {
          const exampleData = fs.readFileSync(examplePath, 'utf-8');
          fs.writeFileSync(this.filePath, exampleData, 'utf-8');
          console.log(`📁 Khởi tạo state.json từ file mẫu: ${examplePath}`);
        } catch (err) {
          console.warn('⚠️ Không thể đọc state.example.json, tạo state rỗng:', err);
          this.writeInitialState();
        }
      } else {
        this.writeInitialState();
      }
    }

    await this.read();
  }

  private writeInitialState(): void {
    const initial: AppState = {
      version: 1,
      groups: [],
      services: [],
      members: {},
      transactions: [],
      reminderReceipts: [],
      monthlyPayments: [],
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), 'utf-8');
  }

  /**
   * Đọc dữ liệu từ state.json (có cache)
   */
  public async read(): Promise<AppState> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      this.cache = JSON.parse(raw) as AppState;
      // Đảm bảo các mảng luôn được khởi tạo
      this.cache.groups = this.cache.groups || [];
      this.cache.services = this.cache.services || [];
      this.cache.members = this.cache.members || {};
      this.cache.transactions = this.cache.transactions || [];
      this.cache.reminderReceipts = this.cache.reminderReceipts || [];
      this.cache.monthlyPayments = this.cache.monthlyPayments || [];
      return this.cache;
    } catch (error) {
      console.error('❌ Lỗi đọc state.json:', error);
      throw error;
    }
  }

  /**
   * Cập nhật state một cách an toàn và tuần tự qua queue (Atomic Write)
   */
  public async update(updater: (state: AppState) => void | Promise<void>): Promise<AppState> {
    return new Promise((resolve, reject) => {
      this.writeQueue = this.writeQueue
        .then(async () => {
          const state = await this.read();
          await updater(state);
          state.updatedAt = new Date().toISOString();

          // Ghi ra file tạm rồi rename (Atomic write)
          const tmpPath = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 7)}`;
          const payload = JSON.stringify(state, null, 2);

          await fs.promises.writeFile(tmpPath, payload, 'utf-8');
          await fs.promises.rename(tmpPath, this.filePath);

          this.cache = state;
          resolve(state);
        })
        .catch(err => {
          console.error('❌ Lỗi khi cập nhật state.json:', err);
          reject(err);
        });
    });
  }

  // --- HELPER GETTERS ---
  public async getGroups(): Promise<Group[]> {
    const s = await this.read();
    return s.groups;
  }

  public async getGroupById(id: string): Promise<Group | undefined> {
    const s = await this.read();
    return s.groups.find(g => g.id === id);
  }

  public async getGroupByChatId(chatId: string): Promise<Group | undefined> {
    const s = await this.read();
    return s.groups.find(g => g.chatId === chatId);
  }

  public async getServices(groupId?: string): Promise<Service[]> {
    const s = await this.read();
    if (groupId) {
      return s.services.filter(svc => svc.groupId === groupId);
    }
    return s.services;
  }

  public async getServiceById(id: string): Promise<Service | undefined> {
    const s = await this.read();
    return s.services.find(svc => svc.id === id);
  }

  public async getMembers(serviceId: string): Promise<Member[]> {
    const s = await this.read();
    return s.members[serviceId] || [];
  }

  public async getTransactions(limit = 100): Promise<Transaction[]> {
    const s = await this.read();
    return [...s.transactions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
  }

  public async getReceipts(limit = 100): Promise<ReminderReceipt[]> {
    const s = await this.read();
    return [...s.reminderReceipts].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()).slice(0, limit);
  }

  /**
   * Khôi phục từ dữ liệu JSON mới
   */
  public async restore(newState: AppState): Promise<void> {
    await this.update(state => {
      state.version = newState.version || 1;
      state.groups = newState.groups || [];
      state.services = newState.services || [];
      state.members = newState.members || {};
      state.transactions = newState.transactions || [];
      state.reminderReceipts = newState.reminderReceipts || [];
      state.monthlyPayments = newState.monthlyPayments || [];
      if (newState.adminPasswordHash) {
        state.adminPasswordHash = newState.adminPasswordHash;
      }
    });
  }
}
