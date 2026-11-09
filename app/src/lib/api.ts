import type { SpecialFund } from './report';
import type { EditOp, Master, Op, SheetRow } from './types';

export interface PullResult { rows: SheetRow[]; master: Master; special?: SpecialFund | null; serverTime: string; capacity?: { used: number; max: number } }
export interface PushResult { opId: string; status: 'done' | 'error'; txId?: string; error?: string; message?: string; repeated?: boolean }

/**
 * network: 応答が届かなかった（スプレッドシートに入ったかどうか分からない）
 * それ以外: スプレッドシート側が理由を返した（入っていない）
 */
export type ApiErrorCode = 'network' | 'unauthorized' | 'busy' | 'server' | 'pair_wrong' | 'pair_expired' | 'bad_response';
export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message: string = code) { super(message); }
}

export interface CsvItem {
  importId: string; date: string; merchant: string; amount: number; method: string; kubun: string; himoku: string; sat: string;
  j: string;            // 03_Card_Import J列の判定（空＝未記録）
  status: string; reason: string;
  looseRows: number[];  // 詳細が空欄で 日付・金額・支払方法 が同じ取引の行
  looseSure: boolean;   // 候補が互いに1件ずつで矛盾がない
}
export type CsvAction = 'add' | 'force' | 'recorded' | 'exclude';
export interface CsvApplyItem { importId: string; action: CsvAction; kubun?: string; himoku?: string; sat?: string; rawRow?: number }
export interface CsvApplyResult { importId: string; status: 'done' | 'error'; error?: string; message?: string; repeated?: boolean }
export interface CsvReadResult { added: number; skipped: number; errors: string[] }

export interface Api {
  csvRead(files: { name: string; base64: string }[]): Promise<CsvReadResult>;
  csvList(): Promise<CsvItem[]>;
  csvApply(items: CsvApplyItem[]): Promise<CsvApplyResult[]>;
  pair(code: string, deviceName: string): Promise<string>;
  pull(): Promise<PullResult>;
  push(ops: Op[]): Promise<PushResult[]>;
  edit(op: EditOp): Promise<PushResult>;
}

/**
 * Apps Script ウェブアプリ。別ドメインから呼ぶため、プリフライトの起きない
 * 「Content-Type なしの POST」で送る（本文は JSON 文字列）。認証は本文の端末鍵で行う。
 */
export class SheetApi implements Api {
  constructor(private url: string, private device: string, private timeoutMs = 45000) {}

  private async call(body: Record<string, unknown>) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(this.url, { method: 'POST', body: JSON.stringify({ v: 1, device: this.device, ...body }), signal: ctl.signal });
    } catch {
      throw new ApiError('network');
    } finally {
      clearTimeout(timer);
    }
    let data: { ok?: boolean; error?: string; message?: string; [k: string]: unknown };
    try { data = await res.json(); } catch { throw new ApiError('bad_response'); }
    if (!data.ok) {
      const known: ApiErrorCode[] = ['unauthorized', 'busy', 'pair_wrong', 'pair_expired'];
      const code: ApiErrorCode = known.find(c => c === data.error) ?? 'server';
      throw new ApiError(code, data.message || data.error || 'server');
    }
    return data;
  }

  async pair(code: string, deviceName: string) {
    const data = await this.call({ action: 'pair', code, deviceName });
    return String(data.token);
  }
  async pull() {
    return (await this.call({ action: 'pull' })) as unknown as PullResult;
  }
  async push(ops: Op[]) {
    const data = await this.call({ action: 'push', ops: ops.map(o => ({ opId: o.opId, type: o.type, tx: o.tx })) });
    return data.results as PushResult[];
  }
  async csvRead(files: { name: string; base64: string }[]) {
    return (await this.call({ action: 'csvRead', files })) as unknown as CsvReadResult;
  }
  async csvList() {
    return (await this.call({ action: 'csvList' })).items as CsvItem[];
  }
  async csvApply(items: CsvApplyItem[]) {
    return (await this.call({ action: 'csvApply', items })).results as CsvApplyResult[];
  }
  async edit(op: EditOp) {
    const data = await this.call({ action: 'push', ops: [op] });
    return (data.results as PushResult[])[0];
  }
}
