import { ApiError, type Api, type PullResult, type PushResult } from './api';
import { daysInMonth, parts, today, ymd } from './date';
import type { Master, Op, SheetRow } from './types';

// デモモード：Apps Script と同じ約束事（冪等な追加・取得）を端末内で再現する。データはすべて架空。
// 「通信を切る」「応答を失う」を切り替えて、オフライン・再送の動きを確かめられる。

const ITEMS: [string, string, number, boolean][] = [
  ['支出（変動費）', '🍙 食費', 60000, true], ['支出（変動費）', '☕ 外食・カフェ', 12000, true],
  ['支出（変動費）', '🧴 日用品', 8000, true], ['支出（変動費）', '👦 こども', 10000, true],
  ['支出（変動費）', '🕹️ 娯楽', 5000, true], ['支出（変動費）', '🏥 医療費', 5000, false],
  ['支出（変動費）', '🚃 交通費', 6000, false], ['支出（変動費）', '❓ その他', 3000, true],
  ['支出（固定費）', '🏠 住居', 90000, false], ['支出（固定費）', '💡 電気', 9000, false],
  ['支出（固定費）', '📱 通信費(携帯）', 6000, false], ['支出（特別費）', '✈ 旅行', 0, false],
  ['支出（特別費）', '🎁 ギフト', 0, false], ['先取り貯金・投資', '💴 NISA', 20000, false],
  ['収入', '💰 給与', 300000, false],
];
const METHODS = ['三井住友VISAカード(C)', '三井住友VISAカード(S)', '楽天カード(C)', 'PayPay', '現金', '口座振替'];

export const demoMaster = (): Master => ({
  items: ITEMS.map(([kubun, himoku, budget, weekly], i) => ({ kubun, himoku, budget, weekly, order: i + 1, note: '', methods: [], group: himoku })),
  methods: METHODS,
});

function seedRows(): SheetRow[] {
  const [y, m, d] = parts(today());
  const rows: SheetRow[] = [];
  const add = (day: number, amount: number, kubun: string, himoku: string, method: string, g: string) => {
    if (day > daysInMonth(y, m) || day > d) return;
    rows.push({ id: `s:demo${rows.length}`, date: ymd(y, m, day), amount, kubun, himoku, method, g, sat: 'ー', source: '手入力' });
  };
  add(1, 300000, '収入', '💰 給与', '口座振替', '');
  add(1, 20000, '先取り貯金・投資', '💴 NISA', '口座振替', '');
  add(3, 90000, '支出（固定費）', '🏠 住居', '口座振替', '');
  [2, 4, 5, 7, 9, 11, 12, 14].forEach((day, i) => add(day, 1200 + i * 370, '支出（変動費）', '🍙 食費', '三井住友VISAカード(C)', 'スーパーA'));
  [6, 13].forEach(day => add(day, 980, '支出（変動費）', '☕ 外食・カフェ', 'PayPay', 'カフェB'));
  add(8, 2400, '支出（変動費）', '🧴 日用品', '現金', 'ドラッグストアC');
  return rows;
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export class DemoApi implements Api {
  rows: SheetRow[] = seedRows();
  ledger = new Map<string, PushResult>();   // 操作ID → 結果（サーバー側の処理済み台帳）
  offline = false;
  loseNextResponse = false;

  private async net() {
    await wait(250);
    if (this.offline || !navigator.onLine) throw new ApiError('network');
  }

  async pair() { await this.net(); return 'demo-device'; }

  async pull(): Promise<PullResult> {
    await this.net();
    const n = new Date(), p = (v: number) => String(v).padStart(2, '0');
    const serverTime = `${n.getFullYear()}/${p(n.getMonth() + 1)}/${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`;
    return { rows: this.rows.map(r => ({ ...r })), master: demoMaster(), serverTime, capacity: { used: this.rows.length, max: 4982 } };
  }

  async push(ops: Op[]): Promise<PushResult[]> {
    await this.net();
    const results = ops.map(op => {
      const seen = this.ledger.get(op.opId);
      if (seen) return { ...seen, repeated: true };
      const t = op.tx;
      const g = t.place && t.detail ? `${t.place}／${t.detail}` : t.place || t.detail;
      this.rows.push({ id: t.id, date: t.date, amount: t.amount, kubun: t.kubun, himoku: t.himoku, method: t.method, g, sat: t.sat || 'ー', source: '手入力' });
      const r: PushResult = { opId: op.opId, status: 'done', txId: t.id };
      this.ledger.set(op.opId, r);
      return r;
    });
    if (this.loseNextResponse) { this.loseNextResponse = false; throw new ApiError('network'); }   // 書込は済んだが応答が届かない
    return results;
  }
}

export const demoApi = new DemoApi();
