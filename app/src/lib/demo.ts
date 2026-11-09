import type { SettingsData, SettingsOp, SettingsResult } from './api';
import { ApiError, type Api, type CsvApplyItem, type CsvApplyResult, type CsvItem, type CsvReadResult, type PullResult, type PushResult } from './api';
import { daysInMonth, parts, today, ymd } from './date';
import type { EditOp, Master, Op, SheetRow } from './types';

const hashOf = (r: SheetRow) => JSON.stringify([r.date, r.amount, r.kubun, r.himoku, r.method, r.g, r.sat, r.source]);

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

function demoCsv(): CsvItem[] {
  const d = today(), card = '三井住友VISAカード(C)', V = '支出（変動費）';
  const base = { date: d, method: card, kubun: V, sat: 'ー', status: '要確認', j: '', looseRows: [] as number[], looseSure: false };
  return [
    { ...base, importId: 'demo-1', merchant: 'ＭＹＢ サンプル店', amount: 1280, himoku: '🍙 食費', reason: '店舗基本設定（MYB）' },
    { ...base, importId: 'demo-2', merchant: 'カフェB', amount: 980, himoku: '☕ 外食・カフェ', reason: 'Rawの確定履歴（同一利用先の最新利用日）' },
    { ...base, importId: 'demo-3', merchant: 'サンプル商店', amount: 3300, himoku: '', reason: '判定できず（要確認）' },
    { ...base, importId: 'demo-4', merchant: 'スーパーA', amount: 1570, himoku: '🍙 食費', reason: '既存の店名ルール', j: '記録済候補' },
    { ...base, importId: 'demo-5', merchant: 'サンプル薬局', amount: 700, himoku: '🧴 日用品', reason: '既存の店名ルール', looseRows: [12], looseSure: true },
    { ...base, importId: 'demo-6', merchant: 'サンプル書店', amount: 500, himoku: '', reason: '判定できず（要確認）', j: '取込内重複候補' },
    { ...base, importId: 'demo-7', merchant: 'サンプル書店', amount: 500, himoku: '', reason: '判定できず（要確認）', j: '取込内重複候補' },
  ];
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export class DemoApi implements Api {
  private settings: SettingsData = { items: demoMaster().items.map((i, n) => ({ kubun: i.kubun, row: n + 3, himoku: i.himoku, group: i.group, order: i.order, budget: i.budget, weekly: i.weekly, hidden: false })), methods: demoMaster().methods.map(name => ({ name, hidden: false })) };
  async settingsRead() { await this.net(); return structuredClone(this.settings); }
  async settingsApply(op: SettingsOp): Promise<SettingsResult> {
    await this.net();
    const s = this.settings, it = s.items.find(i => i.row === op.row);
    await new Promise(r => setTimeout(r, 600));
    if (op.type === 'deleteItem') s.items = s.items.filter(i => i.row !== op.row);
    else if (op.type === 'deleteMethod') s.methods = s.methods.filter(m => m.name !== op.name);
    else if (op.type === 'addMethod') s.methods.push({ name: String(op.name), hidden: false });
    else if (op.type === 'add') s.items.push({ kubun: String(op.kubun), row: 1000 + s.items.length, himoku: String(op.himoku), group: String(op.group || op.himoku), order: Number(op.order) || 999, budget: Number(op.budget) || 0, weekly: false, hidden: false });
    else if (op.type === 'hide') { const m = s.methods.find(x => x.name === op.key), h = s.items.find(x => `${x.kubun}|${x.himoku}` === op.key); (m ?? h)!.hidden = !!op.to; }
    else if (it) (it as unknown as Record<string, unknown>)[String(op.type)] = op.to;
    return { status: 'done' };
  }
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
    return { rows: this.rows.map(r => ({ ...r, hash: hashOf(r) })), master: demoMaster(), special: { balance: 12000, outside: 3000, planned: 58000, actual: 15000, monthlyPlan: 10000, saved: 20000, used: 8000, months: [{ label: '2026/4', plan: 0, actual: 0 }, { label: '2026/5', plan: 20000, actual: 15000 }] }, serverTime, capacity: { used: this.rows.length, max: 4982 } };
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

  // CSV：ファイルの中身は使わず、架空の明細を候補にする。同じ明細は2回目には増えない。
  csvRows: CsvItem[] = [];
  private csvSeen = false;

  async csvRead(): Promise<CsvReadResult> {
    await this.net();
    const samples = demoCsv();
    if (this.csvSeen) return { added: 0, skipped: samples.length, errors: [] };
    this.csvSeen = true;
    this.csvRows = samples;
    return { added: samples.length, skipped: 0, errors: [] };
  }

  async csvList() { await this.net(); return this.csvRows.map(r => ({ ...r })); }

  async csvApply(items: CsvApplyItem[]): Promise<CsvApplyResult[]> {
    await this.net();
    return items.map(it => {
      const i = this.csvRows.findIndex(r => r.importId === it.importId);
      if (i < 0) return { importId: it.importId, status: 'done' as const, repeated: true };
      const [r] = this.csvRows.splice(i, 1);
      if (it.action === 'add' || it.action === 'force') {
        this.rows.push({ id: 's:csv' + r.importId, date: r.date, amount: r.amount, kubun: it.kubun!, himoku: it.himoku!, method: r.method, g: r.merchant, sat: it.sat || 'ー', source: 'カードCSV' });
      }
      return { importId: it.importId, status: 'done' as const };
    });
  }

  async edit(op: EditOp): Promise<PushResult> {
    await this.net();
    const seen = this.ledger.get(op.opId);
    if (seen) return { ...seen, repeated: true };
    const i = this.rows.findIndex(r => r.id === op.target.id && hashOf(r) === op.target.hash);
    if (i < 0) return { opId: op.opId, status: 'error', error: 'conflict' };
    if (op.type === 'delete') this.rows.splice(i, 1);
    else {
      const t = op.tx!;
      this.rows[i] = { ...this.rows[i], date: t.date, amount: t.amount, kubun: t.kubun, himoku: t.himoku, method: t.method, g: t.place, sat: t.sat || 'ー' };
    }
    const r: PushResult = { opId: op.opId, status: 'done', txId: op.target.id };
    this.ledger.set(op.opId, r);
    return r;
  }
}

export const demoApi = new DemoApi();
