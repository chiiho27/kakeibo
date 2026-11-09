import type { ReactNode } from 'react';
import { displayName, yen } from '../lib/display';
import { CHART_INCOME, CHART_EXPENSE, type Slice } from '../lib/report';

/** 残りの割合を示す円ゲージ */
export function Ring({ pct, color, children }: { pct: number; color: string; children: ReactNode }) {
  const size = 96, stroke = 9, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(pct, 1));
  return (
    <div className="ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--light)" strokeWidth={stroke} />
        {p > 0 && <circle className="ringarc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      <span className="ringlabel num">{children}</span>
    </div>
  );
}

/** 内訳の円グラフ。金額は凡例にすべて書く */
export function Donut({ slices, title }: { slices: Slice[]; title: string }) {
  const total = slices.reduce((s, x) => s + x.amount, 0);
  if (!total) return <p className="hint">{title}はまだありません</p>;
  const size = 132, stroke = 18, r = (size - stroke) / 2, c = 2 * Math.PI * r, gap = slices.length > 1 ? 2 : 0;
  let at = 0;
  return (
    <div className="donut">
      <div className="donutchart">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title}の円グラフ。合計 ${yen(total)}`}>
          {slices.map(s => {
            const len = (s.amount / total) * c, offset = at;
            at += len;
            return <circle key={s.name} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
              strokeDasharray={`${Math.max(len - gap, 1)} ${c}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />;
          })}
        </svg>
        <span className="donuttotal num"><small>合計</small>{yen(total)}</span>
      </div>
      <ul className="legend num">
        {slices.map(s => (
          <li key={s.name}><i style={{ background: s.color }} aria-hidden="true" /><span className="legendname">{displayName(s.name)}</span><span>{yen(s.amount)}</span></li>
        ))}
      </ul>
    </div>
  );
}

/** 月ごとの収入と支出の棒グラフ。数字は下の表で見られる */
export function YearBars({ months }: { months: { ym: string; income: number; expense: number }[] }) {
  const max = Math.max(1, ...months.flatMap(m => [m.income, m.expense]));
  const h = (v: number) => (v > 0 ? `${Math.max((v / max) * 100, 2)}%` : '0');
  return (
    <figure className="ybars">
      <div className="yplot" role="img" aria-label="月ごとの収入と支出の棒グラフ。金額は下の表にあります">
        {months.map(m => (
          <div key={m.ym} className="ycol">
            <div className="ytracks"><i style={{ height: h(m.income), background: CHART_INCOME }} /><i style={{ height: h(m.expense), background: CHART_EXPENSE }} /></div>
            <small className="num">{Number(m.ym.slice(5))}</small>
          </div>
        ))}
      </div>
      <figcaption className="ylegend"><span><i style={{ background: CHART_INCOME }} />収入</span><span><i style={{ background: CHART_EXPENSE }} />支出</span></figcaption>
    </figure>
  );
}
