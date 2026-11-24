import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { displayName, yen } from '../lib/display';
import { CHART_EXPENSE, CHART_INCOME, type Slice } from '../lib/report';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const delay = (s: number) => ({ '--d': `${s}s` }) as CSSProperties;

/** 金額を前に表示していた値から数え上げる。動きを減らす設定ではすぐに表示する。 */
export function CountUp({ value, format = yen }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(() => (reduced() ? value : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (reduced()) { setShown(value); from.current = value; return; }
    const start = from.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min((t - t0) / 900, 1), e = 1 - Math.pow(1 - p, 3);
      setShown(start + (value - start) * e);
      if (p < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); };
  }, [value]);
  return <span aria-label={format(value)}><span aria-hidden="true">{format(shown)}</span></span>;
}

/** へこんだ溝の中を伸びる棒。tick は「今日のライン」の位置（0〜1） */
export function Meter({ pct, tone = 'ok', tick, wait = 0, label }: { pct: number; tone?: 'ok' | 'warn' | 'bad'; tick?: number; wait?: number; label: string }) {
  const p = Math.max(0, Math.min(pct, 1));
  return (
    <div className="meter" role="img" aria-label={label}>
      {p > 0 && <i className={tone} style={{ width: `${p * 100}%`, ...delay(wait) }} />}
      {tick !== undefined && <b className="tick" style={{ left: `${Math.max(0, Math.min(tick, 1)) * 100}%` }} />}
    </div>
  );
}

/** 週ごとの変動費。縦線が週の予算、越えた分は赤。今週は黄色 */
export function WeekBars({ weeks }: { weeks: { label: string; spent: number; budget: number; current: boolean; future: boolean }[] }) {
  const max = Math.max(1, ...weeks.map(w => Math.max(w.spent, w.budget))) * 1.05;
  return (
    <div className="weekbars">
      {weeks.map((w, n) => {
        const over = w.spent > w.budget;
        const base = (over ? w.budget : w.spent) / max, extra = over ? (w.spent - w.budget) / max : 0;
        return (
          <div key={w.label} className="wb" role="img" aria-label={`${w.label} 実績 ${yen(w.spent)}、予算 ${yen(w.budget)}、残額 ${yen(w.budget - w.spent)}${over ? '、超過' : ''}`}>
            <div className="row num"><span>{w.label}{w.current ? '（今週）' : ''}</span><span className={over ? 'over' : ''}>実績 {w.future && !w.spent ? '—' : yen(w.spent)}</span></div>
            <div className="row num wbvalues"><span className="muted">予算 {yen(w.budget)}</span><span className={over ? 'over' : 'muted'}>残額 {w.future && !w.spent ? '—' : yen(w.budget - w.spent)}</span></div>
            <div className="wbtrack">
              {base > 0 && <i className={`${w.current ? 'warn' : ''} ${over ? 'cut' : ''}`} style={{ width: `${base * 100}%`, ...delay(0.2 + n * 0.06) }} />}
              {extra > 0 && <i className="bad" style={{ left: `${base * 100}%`, width: `${extra * 100}%`, ...delay(0.5 + n * 0.06) }} />}
              {w.budget > 0 && <b style={{ left: `${(w.budget / max) * 100}%` }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 内訳の円グラフ。項目ごとに順番に描く。金額は凡例にすべて書く */
export function Donut({ slices, title }: { slices: Slice[]; title: string }) {
  const sheen = useId().replace(/:/g, '');
  const total = slices.reduce((s, x) => s + x.amount, 0);
  if (!total) return <p className="hint">{title}はまだありません</p>;
  const size = 132, stroke = 18, r = (size - stroke) / 2, c = 2 * Math.PI * r, gap = slices.length > 1 ? 2 : 0;
  let at = 0;
  return (
    <div className="donut">
      <div className="donutchart">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title}の円グラフ。合計 ${yen(total)}`}>
          <defs>
            {/* ガラスのつや：上から光が当たったように、輪の上側を白く透かす */}
            <linearGradient id={`${sheen}-s`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset=".35" stopColor="#fff" stopOpacity=".05" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="donuttrack" strokeWidth={stroke} />
          {slices.map((s, i) => {
            const len = (s.amount / total) * c, offset = at;
            at += len;
            return <circle key={s.name} className="dseg" style={delay(0.15 + i * 0.12)} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
              strokeDasharray={`${Math.max(len - gap, 1)} ${c}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />;
          })}
          <circle className="dsheen" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${sheen}-s)`} strokeWidth={stroke} />
          <circle cx={size / 2} cy={size / 2} r={r + stroke / 2 - 0.5} fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="1" />
        </svg>
        <span className="donuttotal num"><small>合計</small><CountUp value={total} /></span>
      </div>
      <ul className="legend num">
        {slices.map((s, i) => (
          <li key={s.name} style={delay(0.2 + i * 0.06)}><i style={{ background: s.color }} aria-hidden="true" /><span className="legendname">{displayName(s.name)}</span><span>{yen(s.amount)}</span></li>
        ))}
      </ul>
    </div>
  );
}

/** 月ごとの収入と支出の棒グラフ。数字は下の表で見られる */
export function YearBars({ months, now }: { months: { ym: string; income: number; expense: number }[]; now: string }) {
  const max = Math.max(1, ...months.flatMap(m => [m.income, m.expense]));
  const w = (v: number) => (v > 0 ? `${Math.max((v / max) * 100, 1)}%` : '0');
  return (
    <figure className="ybars">
      <figcaption className="ylegend"><span><i style={{ background: CHART_INCOME }} />収入</span><span><i style={{ background: CHART_EXPENSE }} />支出</span></figcaption>
      <div className="yrows" role="img" aria-label="月ごとの収入と支出の横棒グラフ。金額は下の表にあります">
        {months.map((m, i) => (
          <div key={m.ym} className={`yrow ${m.ym === now ? 'now' : ''}`}>
            <small className="num">{Number(m.ym.slice(5))}月</small>
            <div className="ybar">
              <i style={{ width: w(m.income), backgroundColor: CHART_INCOME, ...delay(0.1 + i * 0.05) }} />
              <i style={{ width: w(m.expense), backgroundColor: CHART_EXPENSE, ...delay(0.13 + i * 0.05) }} />
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}
