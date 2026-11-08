// 金額入力の電卓。式は "1280+300×2" のような文字列で持つ。

const OPS = '+−×÷';
const isOp = (c: string) => OPS.includes(c) && c !== '';

/** 式を計算する（×÷ を先に計算、結果は円単位に四捨五入）。空は 0、0で割ると null。 */
export function evaluate(expr: string): number | null {
  const body = expr && isOp(expr.at(-1)!) ? expr.slice(0, -1) : expr;
  if (!body) return 0;
  const tokens = body.match(/\d+|[+−×÷]/g) ?? [];
  const nums: number[] = [Number(tokens[0])];
  const adds: string[] = [];
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i], n = Number(tokens[i + 1]);
    if (op === '×') nums[nums.length - 1] *= n;
    else if (op === '÷') {
      if (n === 0) return null;
      nums[nums.length - 1] /= n;
    } else { adds.push(op); nums.push(n); }
  }
  const total = nums.reduce((s, n, i) => (i === 0 ? n : adds[i - 1] === '+' ? s + n : s - n), 0);
  return Math.round(total);
}

export type Key = string;   // '0'〜'9', '00', '+', '−', '×', '÷', '=', 'back', 'clear'

export function press(expr: string, key: Key): string {
  if (key === 'clear') return '';
  if (key === 'back') return expr.slice(0, -1);
  if (key === '=') {
    const v = evaluate(expr);
    return v !== null && v > 0 ? String(v) : expr;
  }
  const last = expr.at(-1) ?? '';
  if (isOp(key)) {
    if (!expr) return expr;
    return isOp(last) ? expr.slice(0, -1) + key : expr + key;
  }
  const current = expr.match(/\d+$/)?.[0] ?? '';
  if (current.length + key.length > 9) return expr;
  if (!current && key.startsWith('0')) return expr;   // 数の先頭に0は置かない
  return expr + key;
}

export const hasOperator = (expr: string) => /[+−×÷]/.test(expr);
export const formatExpr = (expr: string) => expr.replace(/\d+/g, n => Number(n).toLocaleString('ja-JP'));
