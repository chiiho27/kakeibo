import { describe, expect, it } from 'vitest';
import { syncMessage } from './store';

describe('同期エラーの表示', () => {
  const base = { sent: 0, failed: 0, pulled: false };

  it('通信・処理中・サーバー側のエラーを区別する', () => {
    expect(syncMessage({ ...base, error: 'network' }, 4)?.text).toContain('通信できませんでした');
    expect(syncMessage({ ...base, error: 'busy' }, 4)?.text).toContain('処理中');
    expect(syncMessage({ ...base, error: 'server', detail: '一時エラー' }, 4)?.text).toContain('一時エラー');
  });
});
