import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { monthTotals } from '../lib/budget';
import { today } from '../lib/date';
import { displayName, yen } from '../lib/display';
import { expenseSlices, fiscalYearOf, monthGroups, yearReport } from '../lib/report';
import type { AppState } from '../lib/store';
import { CountUp, Donut, Meter, YearBars } from './Charts';

export type ReportTab = 'month' | 'year' | 'special';
const TABS: [ReportTab, string][] = [['month', '月別'], ['year', '年間'], ['special', '特別費']];
const GROUPS: [string, string][] = [['支出（変動費）', '変動費'], ['支出（固定費）', '固定費'], ['支出（特別費）', '特別費'], ['先取り貯金・投資', '貯蓄・投資'], ['収入', '収入']];

const money = (v: number | null | undefined) => v == null ? '未設定' : yen(v);
const signed = (n: number) => (n > 0 ? '+' : '') + yen(n);
const monthLabel = (ym: string) => `${Number(ym.slice(5))}月`;
const Line = ({ label, value }: { label: string; value: string }) => <div className="row num reportline"><span className="muted">{label}</span><span>{value}</span></div>;

function Stepper({ label, prev, next }: { label: string; prev?: () => void; next?: () => void }) {
  return (
    <div className="row stepper">
      <button type="button" className="iconbtn round" aria-label="前へ" disabled={!prev} onClick={prev}><ChevronLeft size={20} strokeWidth={2} /></button>
      <b className="num" aria-live="polite">{label}</b>
      <button type="button" className="iconbtn round" aria-label="次へ" disabled={!next} onClick={next}><ChevronRight size={20} strokeWidth={2} /></button>
    </div>
  );
}

function Summary({ title, t }: { title: string; t: { income: number; expense: number; saving: number; balance: number } }) {
  return (
    <section className="section card raised">
      <h2>{title}</h2>
      <div className={`big num ${t.balance < 0 ? 'over' : ''}`}><CountUp value={t.balance} format={signed} /></div>
      <div className="row muted num"><span>収入 {yen(t.income)}</span><span>支出 {yen(t.expense)}</span><span>貯蓄 {yen(t.saving)}</span></div>
    </section>
  );
}

function Month({ app }: { app: AppState }) {
  const now = today().slice(0, 7);
  const months = [...new Set([...app.snap.rows.map(r => r.date.slice(0, 7)), now])].sort();
  const [ym, setYm] = useState(now);
  const i = months.indexOf(ym);
  return (
    <div className="report" key={ym}>
      <Stepper label={`${ym.slice(0, 4)}年${monthLabel(ym)}`} prev={i > 0 ? () => setYm(months[i - 1]) : undefined} next={i < months.length - 1 ? () => setYm(months[i + 1]) : undefined} />
      <Summary title="記録ベース収支" t={monthTotals(app.snap.rows, ym)} />
      <section className="section card"><h2>変動費の内訳</h2><Donut slices={expenseSlices(app.snap.master, app.snap.rows, ym, '支出（変動費）')} title="この月の変動費" /></section>
      {GROUPS.map(([k, label]) => {
        const lines = monthGroups(app.snap.master, app.snap.rows, ym, k);
        // 固定費の予算は月ごとの記録がないので、過去の月には出さない
        const hasBudget = k === '支出（変動費）' || (k === '支出（固定費）' && ym >= now);
        const budgetOf = (l: { group: string; budget: number }) => (k === '支出（変動費）' ? app.snap.frozen?.[ym]?.[l.group] : undefined) ?? l.budget;
        return lines.length > 0 && (
          <section key={k} className="section card">
            <div className="row"><h2>{label}</h2>{hasBudget && <span className="muted">使った / 予算</span>}</div>
            <div className="weekitems">
              {lines.map((l, n) => {
                const b = hasBudget ? budgetOf(l) : 0, over = b > 0 && l.actual > b;
                return (
                  <div key={l.group}>
                    <div className="row num"><span>{displayName(l.group)}</span><span className={over ? 'over' : ''}>{yen(l.actual)}{b > 0 && <small className="muted"> / {yen(b)}</small>}</span></div>
                    {b > 0 && <Meter pct={l.actual / b} tone={over ? 'bad' : 'ok'} wait={0.2 + n * 0.05} label={`${displayName(l.group)} 予算 ${yen(b)} のうち ${yen(l.actual)}`} />}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Year({ app }: { app: AppState }) {
  const current = fiscalYearOf(today());
  const first = Math.min(current, ...app.snap.rows.map(r => fiscalYearOf(r.date)));
  const [fy, setFy] = useState(current);
  const r = yearReport(app.snap.rows, fy);
  return (
    <div className="report" key={fy}>
      <Stepper label={`${fy}年度（4月〜3月）`} prev={fy > first ? () => setFy(fy - 1) : undefined} next={fy < current ? () => setFy(fy + 1) : undefined} />
      <Summary title="年間の収支" t={r.total} />
      <section className="section card"><h2>月ごとの収入と支出</h2><YearBars months={r.months} now={today().slice(0, 7)} /></section>
      <section className="section card">
        <h2>月ごとの金額</h2>
        <table className="yeartable num">
          <thead><tr><th scope="col">月</th><th scope="col">収入</th><th scope="col">支出</th><th scope="col">収支</th></tr></thead>
          <tbody>
            {r.months.map(m => (
              <tr key={m.ym}><th scope="row">{monthLabel(m.ym)}</th><td>{m.income.toLocaleString('ja-JP')}</td><td>{m.expense.toLocaleString('ja-JP')}</td><td className={m.balance < 0 ? 'over' : ''}>{m.balance.toLocaleString('ja-JP')}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="hint">登録済み明細の集計です。口座残高・貯蓄残高ではありません。</p>
    </div>
  );
}

function Special({ app }: { app: AppState }) {
  const s = app.snap.special;
  if (!s) return <p className="muted section">未設定です。スプレッドシートと同期すると表示されます。</p>;
  return (
    <div className="report">
      <section className="section card raised">
        <h2>今使える確保残高</h2>
        <div className="big num">{s.balance == null ? '未設定' : <CountUp value={s.balance} />}</div>
        {s.planned != null && s.actual != null && s.planned > 0 && (
          <>
            <Meter pct={s.actual / s.planned} tone={s.actual > s.planned ? 'bad' : 'ok'} wait={0.2} label={`年間予定額 ${yen(s.planned)} のうち ${yen(s.actual)} を支出`} />
            <div className="row muted num meterkey"><span>年間支出実績 {yen(s.actual)}</span><span>予定 {yen(s.planned)}</span></div>
          </>
        )}
      </section>
      <section className="section card">
        <Line label="毎月の積立計画" value={money(s.monthlyPlan)} />
        <Line label="実際の積立（開始後）" value={money(s.saved)} />
        <Line label="積立から充当（開始後）" value={money(s.used)} />
        <Line label="積立以外からの支出" value={money(s.outside)} />
        {(s.planned == null || s.actual == null) && <><Line label="年間予定額" value={money(s.planned)} /><Line label="年間支出実績" value={money(s.actual)} /></>}
      </section>
      {s.months.length > 0 && (
        <section className="section card">
          <h2>月ごとの予定と実績</h2>
          <table className="yeartable num">
            <thead><tr><th scope="col">月</th><th scope="col">予定</th><th scope="col">実績</th></tr></thead>
            <tbody>{s.months.map(m => <tr key={m.label}><th scope="row">{m.label}</th><td>{money(m.plan)}</td><td>{money(m.actual)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

/** レポート画面。選んでいないボタンは浮き、選んだボタンはへこむ。 */
export function Reports({ app }: { app: AppState }) {
  const [tab, setTab] = useState<ReportTab>('month');
  const unsent = app.ops.length;
  return (
    <div>
      <div className="seg" role="group" aria-label="レポートの種類">
        {TABS.map(([t, label]) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{label}</button>)}
      </div>
      {unsent > 0 && <p className="hint">未送信 {unsent}件は含みません</p>}
      {tab === 'month' && <Month app={app} />}
      {tab === 'year' && <Year app={app} />}
      {tab === 'special' && <Special app={app} />}
    </div>
  );
}
