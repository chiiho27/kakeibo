/**
 * ひとことで入力：「コンビニ 580円 カード」のような1行から、金額・日付・支払方法・費目・詳細を読み取る。
 * 端末の中だけで処理し、外部には送らない。読み取れなかった項目は undefined のまま（入力欄の値を変えない）。
 */
import { isValidYmd, ymd } from './date';

export interface QuickContext {
  today: string;
  methods: string[];                                   // よく使う順
  himoku: { kubun: string; himoku: string }[];         // 候補（表示順）
  history: { place: string; kubun: string; himoku: string }[]; // 過去の詳細と費目
}
export interface QuickResult { amount?: number; date?: string; method?: string; kubun?: string; himoku?: string; place?: string }

const KANJI_DIGIT: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const KANJI_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 「千二百」「1万2000」「3千」などを数にする */
export function kanjiNumber(s: string): number | null {
  let total = 0, section = 0, digit: number | null = null, num = '';
  const flushNum = () => { if (num) { digit = Number(num); num = ''; } };
  for (const ch of s) {
    if (/\d/.test(ch)) { num += ch; continue; }
    flushNum();
    if (ch in KANJI_DIGIT) { digit = (digit ?? 0) * 10 + KANJI_DIGIT[ch]; continue; }
    if (ch in KANJI_UNIT) { section += (digit ?? 1) * KANJI_UNIT[ch]; digit = null; continue; }
    if (ch === '万') { total += (section + (digit ?? 0) || 1) * 10000; section = 0; digit = null; continue; }
    return null;
  }
  flushNum();
  const n = total + section + (digit ?? 0);
  return Number.isFinite(n) ? n : null;
}

const plain = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
// 費目名の絵文字や記号を外す（「🍙 食費」→「食費」）
const bare = (s: string) => s.normalize('NFKC').replace(/[^\p{L}\p{N}ー・]/gu, '').toLowerCase();
// 支払方法の読み方の言い換え（音声入力ではカタカナで出ることが多い）
const ALIASES: [RegExp, RegExp][] = [
  [/ペイペイ|paypay/, /paypay/i], [/スイカ|suica/, /suica/i], [/ビザ|visa/, /visa/i], [/マスター|master/, /master/i],
  [/アイディ|id(?![a-z])/, /(^|[^a-z])id/i], [/クイックペイ|quicpay/, /quicpay/i], [/楽天/, /楽天/], [/イオン/, /イオン|aeon/i],
  [/ゆうちょ/, /ゆうちょ/], [/口座|振込|振り込み|引き落とし/, /口座|振込|銀行/],
];

export function parseQuick(text: string, ctx: QuickContext): QuickResult {
  const out: QuickResult = {};
  let rest = text.normalize('NFKC').replace(/[、。，．,]/g, m => (m === ',' || m === '，' ? '' : ' '));

  // 金額：「580円」「¥1,200」「千二百円」「1万2000円」。円がなくても数字だけなら金額とみなす
  const yenRe = /[¥￥]?\s*([\d〇零一二三四五六七八九十百千万]+)\s*円|[¥￥]\s*([\d〇零一二三四五六七八九十百千万]+)/;
  let m = rest.match(yenRe);
  const dateLike = /(\d{1,2})\s*月\s*(\d{1,2})\s*日|(\d{1,2})\s*\/\s*(\d{1,2})|(\d{1,2})\s*日/;
  if (!m) {
    const masked = rest.replace(new RegExp(dateLike.source, 'g'), s => ' '.repeat(s.length));
    const bareNum = masked.match(/\d+/);
    if (bareNum) m = Object.assign([bareNum[0], bareNum[0]], { index: bareNum.index }) as unknown as RegExpMatchArray;
  }
  if (m) {
    const n = kanjiNumber(m[1] ?? m[2]);
    if (n && n > 0) { out.amount = n; rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index! + m[0].length); }
  }

  // 日付：今日・昨日・おととい・「11月18日」「11/18」「18日」
  const [ty, tm, td] = ctx.today.split('-').map(Number);
  const shift = (d: number) => { const t = new Date(ty, tm - 1, td + d); return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate()); };
  const rel: [RegExp, number][] = [[/おととい|一昨日/, -2], [/きのう|昨日/, -1], [/きょう|今日/, 0]];
  for (const [re, d] of rel) if (re.test(rest)) { out.date = shift(d); rest = rest.replace(re, ' '); break; }
  if (!out.date) {
    const dm = rest.match(dateLike);
    if (dm) {
      const mon = Number(dm[1] ?? dm[3] ?? tm), day = Number(dm[2] ?? dm[4] ?? dm[5]);
      // 先の日付になるなら去年（1月に「12月30日」と言ったとき）
      const year = mon > tm ? ty - 1 : ty;
      const d = ymd(year, mon, day);
      if (isValidYmd(d)) { out.date = d; rest = rest.replace(dm[0], ' '); }
    }
  }

  // 支払方法：名前がそのまま含まれるか、言い換えで当たるもの。「カード」だけならよく使うカード
  const low = plain(rest);
  const named = ctx.methods.map(name => ({ name, key: plain(name.replace(/[(（][^)）]*[)）]/g, '')) }))
    .filter(x => x.key.length >= 2 && low.includes(x.key)).sort((a, b) => b.key.length - a.key.length)[0];
  if (named) { out.method = named.name; rest = removeLoose(rest, named.key); }
  else {
    for (const [said, inName] of ALIASES) {
      if (!said.test(low)) continue;
      const hit = ctx.methods.find(x => inName.test(x.normalize('NFKC')));
      if (hit) { out.method = hit; rest = rest.replace(new RegExp(said.source, 'i'), ' '); break; }
    }
    if (!out.method && /現金|げんきん/.test(low)) {
      const hit = ctx.methods.find(x => /現金/.test(x));
      if (hit) { out.method = hit; rest = rest.replace(/現金|げんきん/, ' '); }
    }
    if (!out.method && /カード/.test(low)) {
      const hit = ctx.methods.find(x => /カード|card|visa|master|jcb|amex/i.test(x));
      if (hit) { out.method = hit; rest = rest.replace(/(クレジット)?カード/, ' '); }
    }
  }

  // 費目：費目名がそのまま含まれていれば、それを使う
  const lowRest = bare(rest);
  const named2 = ctx.himoku.map(h => ({ ...h, key: bare(h.himoku) })).filter(h => h.key.length >= 2 && lowRest.includes(h.key))
    .sort((a, b) => b.key.length - a.key.length)[0];
  if (named2) { out.kubun = named2.kubun; out.himoku = named2.himoku; rest = removeLoose(rest, named2.key); }

  // 残りが詳細（「で」「に」などの助詞は外す）。過去の詳細と一致すれば、その表記と費目を使う
  const place = rest.replace(/(^|\s)(で|に|を|の|は|と|払い|払った|使った|買った)(?=\s|$)/g, ' ')
    .replace(/(で|に|を)\s*$/, '').replace(/\s+/g, ' ').trim();
  if (place) {
    const key = plain(place);
    const hit = ctx.history.find(h => plain(h.place) === key)
      ?? ctx.history.filter(h => plain(h.place).length >= 2 && (key.includes(plain(h.place)) || plain(h.place).startsWith(key)))
        .sort((a, b) => plain(b.place).length - plain(a.place).length)[0];
    out.place = hit && plain(hit.place).startsWith(key) ? hit.place : place;
    if (hit && !out.himoku && ctx.himoku.some(h => h.kubun === hit.kubun && h.himoku === hit.himoku)) { out.kubun = hit.kubun; out.himoku = hit.himoku; }
  }
  return out;
}

// 大文字小文字・全角半角・空白を無視して、最初に見つかった箇所を外す
function removeLoose(s: string, key: string): string {
  const norm = [...s].map(c => plain(c));
  for (let i = 0; i < norm.length; i++) {
    let acc = '', j = i;
    while (j < norm.length && acc.length < key.length) acc += norm[j++];
    if (acc === key) return [...s].slice(0, i).join('') + ' ' + [...s].slice(j).join('');
  }
  return s;
}
