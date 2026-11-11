import { afterEach, describe, expect, it, vi } from 'vitest';
import { SheetApi } from './api';
import type { Op } from './types';

const tx = { id: 't1', date: '2026-11-10', amount: 1860, kubun: '支出（変動費）' as const, himoku: '食費', method: 'カード', place: '店', detail: '', sat: '' };

describe('スプレッドシートへの送信', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('修正・削除は対象の行（行番号と目印）も送る', async () => {
    let sent: { ops: Op[] } | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, results: [] }));
    }));
    const ops: Op[] = [
      { opId: 'a', type: 'add', tx, state: 'pending', createdAt: 0 },
      { opId: 'u', type: 'update', tx, target: { id: 't1', hash: 'abc', row: 1269 }, state: 'pending', createdAt: 0 },
    ];
    await new SheetApi('https://example.invalid/exec', 'dev').push(ops);
    expect(sent!.ops[0]).not.toHaveProperty('target');
    expect(sent!.ops[1].target).toEqual({ id: 't1', hash: 'abc', row: 1269 });
  });
});
