import { CircleAlert, CircleCheck, Heart, Leaf, Smile, Sprout, Star, type LucideIcon } from 'lucide-react';
import { isNoMoneyDay, monthTotals, unsentTxs, weekStatus } from '../lib/budget';
import { daysInMonth, parts, today, weekdayMon, ymd } from '../lib/date';
import { yen } from '../lib/display';
import type { AppState } from '../lib/store';
import { K_VAR } from '../lib/types';
import { expenseSlices, nmdStats, weekPace } from '../lib/report';
import { Donut, Ring } from './Charts';
import type { ReportTab } from './Reports';

const NMD: Record<string, LucideIcon> = { sprout: Sprout, leaf: Leaf, star: Star, smile: Smile, 'circle-check': CircleCheck, heart: Heart };

export function NmdMark({ icon, size = 24 }: { icon: string; size?: number }) {
  if (!icon.startsWith('lucide:')) return <span aria-hidden="true" style={{ fontSize: size * 0.9, lineHeight: 1 }}>{icon}</span>;
  const I = NMD[icon.slice(7)] ?? Sprout;
  return <I size={size} strokeWidth={2} aria-hidden="true" />;
}

export function Home({ app, onReport }: { app: AppState; onReport: (t: ReportTab) => void }) {
  const { snap, ops, prefs } = app;
  const day = today();
  const [y, m] = parts(day);
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  const unsent = unsentTxs(ops, snap.rows);
  const w = weekStatus(snap.master, snap.rows, unsent, day);
  const confirmed = monthTotals(snap.rows, ym);
  const withUnsent = monthTotals([...snap.rows, ...unsent], ym);
  const hasData = snap.rows.length > 0 || snap.master.items.length > 0;
  const all = [...snap.rows, ...unsent];
  const days = Array.from({ length: daysInMonth(y, m) }, (_, i) => ymd(y, m, i + 1));
  const varOf = (d: string) => all.filter(e => e.date === d && e.kubun === K_VAR).reduce((s, e) => s + e.amount, 0);

  const dailyGuide = w.hasWeeklyItems && w.week.days.length ? w.budget / w.week.days.length : 0;
  const pace = weekPace(w.budget, w.left, w.week.days, day);
  const nmdCount = nmdStats(all, ym, day);
  const leftPct = w.budget > 0 ? Math.max(w.left, 0) / w.budget : 0;

  return (
    <div className="home">
      <nav className="section area-more filters" aria-label="集計">
        <button type="button" onClick={() => onReport('month')}>月別</button>
        <button type="button" onClick={() => onReport('year')}>年間</button>
        <button type="button" onClick={() => onReport('special')}>特別費</button>
      </nav>
      <section className="section card area-week" aria-labelledby="h-week">
        <h2 id="h-week">今週あと使える金額</h2>
        {!hasData ? <p className="muted">スプレッドシートの取得前です</p>
          : !w.hasWeeklyItems ? <p className="muted">週管理の費目が設定されていません</p> : (
          <>
            <div className="herorow">
              <Ring pct={leftPct} color={w.left < 0 ? 'var(--error)' : pace < 0 ? 'var(--warn)' : 'var(--primary)'}><b>{Math.round(leftPct * 100)}%</b><small>残り</small></Ring>
              <div className="herotext">
                <div className={`hero num ${w.left < 0 ? 'over' : ''}`}>{yen(w.left)}</div>
                {w.left < 0 ? <p className="pace bad"><CircleAlert size={16} aria-hidden="true" />予算を {yen(-w.left)} 超えています</p>
                  : pace >= 0 ? <p className="pace good"><CircleCheck size={16} aria-hidden="true" />目安より {yen(pace)} 少なく使えています</p>
                  : <p className="pace warn"><CircleAlert size={16} aria-hidden="true" />目安より {yen(-pace)} 多く使っています</p>}
              </div>
            </div>
            <div className="stats num">
              {w.left > 0 && w.daysLeft > 0 && <div><small>1日あたり</small><b>{yen(w.left / w.daysLeft)}</b></div>}
              <div><small>使った金額</small><b>{yen(w.confirmed)}</b></div>
              <div><small>週の予算</small><b>{yen(w.budget)}</b></div>
            </div>
            {w.unsent > 0 && <p className="hint">未送信分 {yen(w.unsent)} を含みます</p>}
          </>
        )}
      </section>

      <section className="section card area-month" aria-labelledby="h-month">
        <h2 id="h-month">今月の収支</h2>
        {!hasData ? <p className="muted">スプレッドシートの取得前です</p> : (
          <>
            <div className={`big num ${confirmed.balance < 0 ? 'over' : ''}`}>{yen(confirmed.balance)}</div>
            <div className="row muted num"><span>収入</span><span>{yen(confirmed.income)}</span></div>
            <div className="row muted num"><span>支出</span><span>{yen(confirmed.expense)}</span></div>
            <div className="row muted num"><span>先取り貯金・投資</span><span>{yen(confirmed.saving)}</span></div>
            {unsent.length > 0 && <p className="hint">未送信 {unsent.length}件を含めると {yen(withUnsent.balance)}</p>}
          </>
        )}
      </section>

      <section className="section card area-cal" aria-labelledby="h-cal">
        <h2 id="h-cal">{m}月の変動費</h2>
        {hasData && (
          <div className="stats nmdstats num">
            <div><small>今月のNMD</small><b><NmdMark icon={prefs.nmdIcon} size={16} />{nmdCount.month}日</b></div>
            <div><small>連続</small><b>{nmdCount.streak}日</b></div>
            <div><small>先月</small><b>{nmdCount.lastMonth}日</b></div>
          </div>
        )}
        <div className="calgrid">
          {'月火水木金土日'.split('').map(d => <span key={d} className="muted wd">{d}</span>)}
          {Array.from({ length: weekdayMon(days[0]) }, (_, i) => <span key={i} />)}
          {days.map(d => {
            const total = varOf(d), nmd = hasData && isNoMoneyDay(all, d, day);
            return (
              <div key={d} className={`mday ${w.week.days.includes(d) ? 'thisweek' : ''} ${d === day ? 'today' : ''}`}>
                <span className="dn num">{parts(d)[2]}</span>
                {total > 0 && <span className={`dv num ${dailyGuide > 0 && total > dailyGuide ? 'high' : ''}`}>{total.toLocaleString('ja-JP')}</span>}
                {nmd ? <><span className="nmdmark"><NmdMark icon={prefs.nmdIcon} size={16} /></span><span className="sr">変動費なし</span></> : null}
              </div>
            );
          })}
        </div>
      </section>

      {hasData && (
        <section className="section card area-donut" aria-labelledby="h-donut">
          <h2 id="h-donut">今月の変動費の内訳</h2>
          <Donut slices={expenseSlices(snap.master, all, ym, K_VAR)} title="今月の変動費" />
        </section>
      )}
    </div>
  );
}
