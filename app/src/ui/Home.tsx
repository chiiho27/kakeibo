import { CircleAlert, CircleCheck, Heart, Leaf, Smile, Sprout, Star, type LucideIcon } from 'lucide-react';
import { isNoMoneyDay, monthTotals, unsentTxs, weekStatus } from '../lib/budget';
import { daysInMonth, parts, today, weekdayMon, ymd } from '../lib/date';
import { yen } from '../lib/display';
import type { AppState } from '../lib/store';
import { K_VAR } from '../lib/types';

const NMD: Record<string, LucideIcon> = { sprout: Sprout, leaf: Leaf, star: Star, smile: Smile, 'circle-check': CircleCheck, heart: Heart };

export function NmdMark({ icon, size = 24 }: { icon: string; size?: number }) {
  if (!icon.startsWith('lucide:')) return <span aria-hidden="true" style={{ fontSize: size * 0.9, lineHeight: 1 }}>{icon}</span>;
  const I = NMD[icon.slice(7)] ?? Sprout;
  return <I size={size} strokeWidth={2} aria-hidden="true" />;
}

export function Home({ app }: { app: AppState }) {
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

  return (
    <div className="home">
      <section className="section card tint area-week" aria-labelledby="h-week">
        <h2 id="h-week">今週あと使える金額</h2>
        {!hasData ? <p className="muted">スプレッドシートの取得前です</p>
          : !w.hasWeeklyItems ? <p className="muted">週管理の費目が設定されていません</p> : (
          <>
            <div className={`big num ${w.left < 0 ? 'over' : ''}`}>{yen(w.left)}</div>
            {w.left < 0 && <p className="err"><CircleAlert size={16} />予算を {yen(-w.left)} 超えています</p>}
            <div className="row muted num"><span>週の予算（{w.week.days.length}日分）</span><span>{yen(w.budget)}</span></div>
            <div className="row muted num"><span>使った金額</span><span>{yen(w.confirmed)}</span></div>
            {w.unsent > 0 && <div className="row muted num"><span>未送信分</span><span>{yen(w.unsent)}</span></div>}
            {w.left > 0 && w.daysLeft > 0 && <div className="row muted num"><span>1日あたり（残り{w.daysLeft}日）</span><span>{yen(w.left / w.daysLeft)}</span></div>}
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
        <div className="calgrid">
          {'月火水木金土日'.split('').map(d => <span key={d} className="muted wd">{d}</span>)}
          {Array.from({ length: weekdayMon(days[0]) }, (_, i) => <span key={i} />)}
          {days.map(d => {
            const total = varOf(d), nmd = hasData && isNoMoneyDay(all, d, day);
            return (
              <div key={d} className={`mday ${w.week.days.includes(d) ? 'thisweek' : ''} ${d === day ? 'today' : ''}`}>
                <span className="dn num">{parts(d)[2]}</span>
                {total > 0 && <span className="dv num">{total.toLocaleString('ja-JP')}</span>}
                {nmd ? <><NmdMark icon={prefs.nmdIcon} size={16} /><span className="sr">変動費なし</span></> : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
