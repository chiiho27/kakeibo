import { CircleAlert, CircleCheck, Heart, Leaf, Smile, Sprout, Star, type LucideIcon } from 'lucide-react';
import { isNoMoneyDay, monthTotals, unsentTxs, weekItems, weekStatus } from '../lib/budget';
import { daysInMonth, parts, slash, today, weekdayMon, ymd } from '../lib/date';
import { displayName, yen } from '../lib/display';
import { expenseSlices } from '../lib/report';
import type { AppState } from '../lib/store';
import { K_VAR } from '../lib/types';
import { CountUp, Donut, Meter } from './Charts';

const NMD: Record<string, LucideIcon> = { sprout: Sprout, leaf: Leaf, star: Star, smile: Smile, 'circle-check': CircleCheck, heart: Heart };

export function NmdMark({ icon, size = 24 }: { icon: string; size?: number }) {
  if (!icon.startsWith('lucide:')) return <span aria-hidden="true" style={{ fontSize: size * 0.9, lineHeight: 1 }}>{icon}</span>;
  const I = NMD[icon.slice(7)] ?? Sprout;
  return <I size={size} strokeWidth={2} aria-hidden="true" />;
}

const signed = (n: number) => (n > 0 ? '+' : '') + yen(n);

export function Home({ app }: { app: AppState }) {
  const { snap, ops, prefs } = app;
  const day = today();
  const [y, m] = parts(day);
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  const unsent = unsentTxs(ops, snap.rows);
  const all = [...snap.rows, ...unsent];
  const w = weekStatus(snap.master, snap.rows, unsent, day);
  const items = weekItems(snap.master, all, day);
  const month = monthTotals(snap.rows, ym);
  const withUnsent = monthTotals(all, ym);
  const hasData = snap.rows.length > 0 || snap.master.items.length > 0;
  const days = Array.from({ length: daysInMonth(y, m) }, (_, i) => ymd(y, m, i + 1));
  const varOf = (d: string) => all.filter(e => e.date === d && e.kubun === K_VAR).reduce((s, e) => s + e.amount, 0);
  const nmdDays = hasData ? days.filter(d => isNoMoneyDay(all, d, day) === true && all.some(e => e.date <= d)) : [];

  // 見込み：今日までと同じペースで使い続けたとき、週の終わりに残る金額
  const spent = w.confirmed + w.unsent;
  const elapsed = Math.max(w.week.days.indexOf(day) + 1, 1);
  const forecast = Math.round(w.budget - (spent / elapsed) * w.week.days.length);
  const tone = w.left < 0 ? 'bad' : forecast < 0 ? 'warn' : 'ok';
  const daily = w.budget / Math.max(w.week.days.length, 1);

  return (
    <div className="home">
      <section className="section card area-week" aria-labelledby="h-week">
        <div className="row"><h2 id="h-week">今週の残予算</h2><span className="muted num">{slash(w.week.days[0]).slice(5)}〜{slash(w.week.days[w.week.days.length - 1]).slice(5)}</span></div>
        {!hasData ? <p className="muted">スプレッドシートの取得前です</p>
          : !w.hasWeeklyItems ? <p className="muted">週管理の費目が設定されていません</p> : (
          <>
            <div className={`hero num ${w.left < 0 ? 'over' : ''}`}><CountUp value={w.left} /></div>
            <Meter pct={w.budget > 0 ? spent / w.budget : 0} tone={tone} wait={0.2} label={`週の予算 ${yen(w.budget)} のうち ${yen(spent)} を使いました`} />
            <div className="row muted num meterkey"><span>使った {yen(spent)}</span><span>週の予算 {yen(w.budget)}</span></div>
            {w.left < 0
              ? <p className="pace bad"><CircleAlert size={16} aria-hidden="true" />予算を {yen(-w.left)} 超えています</p>
              : forecast >= 0
                ? <p className="pace good"><CircleCheck size={16} aria-hidden="true" />このペースなら週末に {yen(forecast)} 残ります</p>
                : <p className="pace warn"><CircleAlert size={16} aria-hidden="true" />このペースだと週末に {yen(-forecast)} 足りません</p>}
            {w.left > 0 && w.daysLeft > 0 && <div className="row num daily"><span>今日から1日 <b>{yen(w.left / w.daysLeft)}</b> まで</span><span className="muted">残り{w.daysLeft}日</span></div>}
            {w.unsent > 0 && <p className="hint">未送信分 {yen(w.unsent)} を含みます</p>}
          </>
        )}
      </section>

      {hasData && items.length > 0 && (
        <section className="section card area-items" aria-labelledby="h-items">
          <div className="row"><h2 id="h-items">今週の費目</h2><span className="muted">使った / 週の予算</span></div>
          <div className="weekitems">
            {items.map((it, i) => (
              <div key={it.himoku}>
                <div className="row num"><span>{displayName(it.himoku)}</span><span className={it.spent > it.budget ? 'over' : ''}>{yen(it.spent)} <small className="muted">/ {yen(it.budget)}</small></span></div>
                <Meter pct={it.budget > 0 ? it.spent / it.budget : it.spent > 0 ? 1 : 0} tone={it.spent > it.budget ? 'bad' : 'ok'} wait={0.25 + i * 0.08}
                  label={`${displayName(it.himoku)} 週の予算 ${yen(it.budget)} のうち ${yen(it.spent)}`} />
              </div>
            ))}
          </div>
        </section>
      )}

      {hasData && (
        <section className="section card area-donut" aria-labelledby="h-donut">
          <h2 id="h-donut">今月の変動費の内訳</h2>
          <Donut slices={expenseSlices(snap.master, all, ym, K_VAR)} title="今月の変動費" />
        </section>
      )}

      <section className="section card area-month" aria-labelledby="h-month">
        <div className="row"><h2 id="h-month">今月の収支</h2>
          {hasData && <span className={`mid num ${month.balance < 0 ? 'over' : ''}`}><CountUp value={month.balance} format={signed} /></span>}</div>
        {!hasData ? <p className="muted">スプレッドシートの取得前です</p> : (
          <>
            <div className="row muted num"><span>収入 {yen(month.income)}</span><span>支出 {yen(month.expense)}</span><span>貯蓄 {yen(month.saving)}</span></div>
            {unsent.length > 0 && <p className="hint">未送信 {unsent.length}件を含めると {signed(withUnsent.balance)}</p>}
          </>
        )}
      </section>

      <section className="section card area-cal" aria-labelledby="h-cal">
        <h2 id="h-cal" className="nmdtitle">今月のNMD <b className="num">{nmdDays.length}</b> 日</h2>
        <div className="calgrid">
          {'月火水木金土日'.split('').map(d => <span key={d} className="muted wd">{d}</span>)}
          {Array.from({ length: weekdayMon(days[0]) }, (_, i) => <span key={i} />)}
          {days.map(d => {
            const total = varOf(d), nmd = nmdDays.includes(d);
            return (
              <div key={d} className={`mday ${d === day ? 'today' : ''} ${d > day ? 'future' : ''}`}>
                {nmd ? <span className="nmdcell" style={{ '--d': `${0.3 + nmdDays.indexOf(d) * 0.06}s` } as React.CSSProperties}>
                  <NmdMark icon={prefs.nmdIcon} size={16} /><span className="sr">{parts(d)[2]}日 変動費なし</span></span>
                  : <span className="dn num">{parts(d)[2]}</span>}
                {total > 0 && <span className={`dv num ${total > daily && w.hasWeeklyItems ? 'high' : ''}`}>{total.toLocaleString('ja-JP')}</span>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
