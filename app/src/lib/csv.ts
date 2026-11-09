import type { CsvAction, CsvApplyItem, CsvItem } from './api';

/** 画面で選んだ処理。'' は未判断（反映しない）。 */
export interface CsvChoice { action: 'add' | 'recorded' | 'exclude' | ''; key: string }   // key = 区分|費目

export const needsReview = (i: CsvItem) => !!i.j || i.looseRows.length > 0 || !i.himoku || i.amount <= 0;

export function reviewReason(i: CsvItem): string {
  if (i.amount <= 0) return '返金などのマイナスの明細です';
  if (i.j === '記録済候補') return '同じ内容の取引が記録済みです';
  if (i.j) return `重複の可能性があります（${i.j}）`;
  if (i.looseRows.length) return i.looseSure ? '日付・金額・支払方法が同じ取引があります（詳細は空欄）' : '日付・金額・支払方法が同じ取引が複数あります';
  if (!i.himoku) return '費目を確認してください';
  return '';
}

/** 初期の選択。矛盾なく1対1で対応するものだけ「記録済み」を選んでおき、曖昧なものは未判断にする。 */
export function initialChoice(i: CsvItem): CsvChoice {
  const key = i.himoku ? `${i.kubun}|${i.himoku}` : '';
  if (i.amount <= 0) return { action: '', key };
  if (i.j === '記録済候補' || i.looseSure) return { action: 'recorded', key };
  if (i.j || i.looseRows.length) return { action: '', key };
  return { action: key ? 'add' : '', key };
}

/** 反映する内容へ変換する。登録なのに費目が未選択の明細は送らない。 */
export function toApply(i: CsvItem, c: CsvChoice): CsvApplyItem | null {
  if (!c.action) return null;
  if (c.action === 'exclude') return { importId: i.importId, action: 'exclude' };
  if (c.action === 'recorded') return { importId: i.importId, action: 'recorded', rawRow: i.looseSure ? i.looseRows[0] : undefined };
  if (!c.key) return null;
  const [kubun, ...h] = c.key.split('|');
  const action: CsvAction = i.j ? 'force' : 'add';
  return { importId: i.importId, action, kubun, himoku: h.join('|'), sat: i.sat };
}
