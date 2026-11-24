import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Reports } from './Reports';
import type { AppState } from '../lib/store';
import type { SheetRow } from '../lib/types';

// 取得済み正本と端末内の修正が違う場合も、レポートは正本の金額を表示する。
describe('レポートの同期済み集計', () => {
  afterEach(() => vi.useRealTimers());
  it('未送信の追加・修正・削除を週・月の実績に混ぜない', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 24, 12));
    const row = (id: string, himoku: string, amount: number): SheetRow =>
      ({ id, himoku, amount, date: '2026-11-02', kubun: '支出（変動費）', method: '', g: '', sat: '', source: '' });
    const master = { methods: [], items: [
      { kubun: '支出（変動費）', himoku: '食費', budget: 30000, group: '食費', weekly: true, note: '', methods: [], order: 1 },
      { kubun: '支出（変動費）', himoku: '医療費', budget: 12000, group: '医療費', weekly: false, note: '', methods: [], order: 2 },
      { kubun: '支出（固定費）', himoku: 'ネット', budget: 10000, group: '通信費', weekly: false, note: '', methods: [], order: 1 },
      { kubun: '支出（固定費）', himoku: '携帯', budget: 5000, group: '通信費', weekly: false, note: '', methods: [], order: 2 },
    ] };
    const confirmedSnap = { master, rows: [row('update', '食費', 1000), row('delete', '食費', 500), row('other', '医療費', 2000), { ...row('fixed', 'ネット', 6000), kubun: '支出（固定費）' }, { ...row('fixed2', '携帯', 3000), kubun: '支出（固定費）' }], fetchedAt: '' };
    const ops = [
      { opId: 'u', type: 'update', target: { id: 'update' }, tx: { ...row('update', '食費', 9999), place: '', detail: '' }, state: 'pending', createdAt: 0 },
      { opId: 'd', type: 'delete', target: { id: 'delete' }, tx: { ...row('delete', '食費', 500), place: '', detail: '' }, state: 'pending', createdAt: 0 },
      { opId: 'a', type: 'add', tx: { ...row('add', '食費', 800), place: '', detail: '' }, state: 'pending', createdAt: 0 },
    ];
    const app = { confirmedSnap, snap: { ...confirmedSnap, rows: [row('update', '食費', 9999), row('other', '医療費', 2000)] }, ops } as unknown as AppState;
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<Reports app={app} />);
    expect(host.textContent).toContain('未送信の追加・修正・削除 3件は反映していません');
    const weeks = [...host.querySelectorAll('.weekbars [role="img"]')];
    expect(weeks[1].getAttribute('aria-label')).toContain('実績 ¥1,500、予算 ¥7,000、残額 ¥5,500');
    expect(host.querySelector('.donutchart svg')?.getAttribute('aria-label')).toContain('合計 ¥3,500');
    expect(host.querySelector('.monthbudget')?.textContent).toContain('¥42,000');
    expect(host.querySelector('.monthbudget')?.textContent).toContain('¥38,500');
    const fixed = [...host.querySelectorAll('section')].find(s => s.querySelector('h2')?.textContent === '固定費')!;
    expect(fixed.querySelector('.monthbudget')?.textContent).toBe('全固定費の月予算¥15,000使った額¥9,000');
  });
});
