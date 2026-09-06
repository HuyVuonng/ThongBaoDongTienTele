import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JsonStore } from '../src/store/json-store.js';

describe('JsonStore Atomic Operations Test', () => {
  const testDataPath = path.resolve(process.cwd(), 'data/state.test.json');

  beforeAll(() => {
    process.env.DATA_PATH = './data/state.test.json';
  });

  afterAll(() => {
    if (fs.existsSync(testDataPath)) {
      try {
        fs.unlinkSync(testDataPath);
      } catch (_) {}
    }
  });

  it('nên khởi tạo và đọc ghi an toàn', async () => {
    const store = JsonStore.getInstance();
    await store.init();

    const state = await store.read();
    expect(state).toBeDefined();
    expect(Array.isArray(state.groups)).toBe(true);

    // Test ghi dữ liệu
    await store.update(s => {
      s.groups.push({
        id: 'test-grp-1',
        chatId: '-100999999',
        title: 'Nhóm Test Write',
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });

    const updated = await store.read();
    expect(updated.groups.some(g => g.id === 'test-grp-1')).toBe(true);
  });
});
