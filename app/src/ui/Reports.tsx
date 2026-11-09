import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { monthTotals } from '../lib/budget';
import { today } from '../lib/date';
import { displayName, yen } from '../lib/display';
import { fiscalYearOf, monthGroups, yearReport } from '../lib/report';
import type { AppState } from '../lib/store';
import { Sheet } from './Sheet';

export type ReportTab = 'month' | 'year' | 'special';
const TABS: [ReportTab, string][] = [['month', '月別'], ['year', '年間'], ['special', '特別費']];
const GROUPS: [string, string][] = [['支出（変動費）', '変動費'], ['支出（固定費）', '固定費'], ['支出（特別費）', '特別費'], ['先取り貯金・投資', '貯蓄・投資'], ['収入', '収入']];

const money = (v: number | null | undefined) => v == null ? '未設定' : yen(v);
const monthLabel = (ym: string) => `${Number(ym.slice(5))}月`;
const Line = ({ label, value }: { label: string; value: string }) => <div className="row num reportline"><span>{label}</span><span>{value}</span></div>;

function Stepper({ label, prev, next }: { label: string; prev?: () => void; next?: () => void }) {
  return (
    <div className="row stepper">
      <button type="button" className="iconbtn" aria-label="前へ" disabled={!prev} onClick={prev}><ChevronLeft size={24} strokeWidth={2} /></button>
      <b className="num" aria-live="polite">{label}</b>
      <button type="button" className="iconbtn" aria-label="次へ" disabled={!next} onClick={next}><ChevronRight size={24} strokeWidth={2} /></button>
    </div>
  );
}

function Month({ app }: { app: AppState }) {
  const now = today().slice(0, 7);
  const months = [...new Set([...app.snap.rows.map(r => r.date.slice(0, 7)), now])].sort();
  const [ym, setYm] = useState(now);
  const i = months.indexOf(ym);
  const t = monthTotals(app.snap.rows, ym);
  return (
    <>
      <Stepper label={`${ym.slice(0, 4)}年${monthLabel(ym)}`} prev={i > 0 ? () => setYm(months[i - 1]) : undefined} next={i < months.length - 1 ? () => setYm(months[i + 1]) : undefined} />
      <div className="card tint">
        <h2>記録ベース収支</h2>
        <div className={`big num ${t.balance < 0 ? 'over' : ''}`}>{yen(t.balance)}</div>
        <Line label="収入" value={yen(t.income)} /><Line label="支出" value={yen(t.expense)} /><Line label="先取り貯金・投資" value={yen(t.saving)} />
      </div>
      {GROUPS.map(([k, label]) => {
        const lines = monthGroups(app.snap.master, app.snap.rows, ym, k);
        const hasBudget = k === '支出（変動費）' || k === '支出（固定費）';
        return lines.length > 0 && (
          <section key={k} className="section">
            <h2 className="h" style={{ marginTop: 0 }}>{label}</h2>
            <div className="list">
              {lines.map(l => (
                <div key={l.group} className="li reportitem">
                  <span className="grow">{displayName(l.group)}</span>
                  <span className="num">{yen(l.actual)}{hasBudget && l.budget > 0 && <small className="muted"> / {yen(l.budget)}</small>}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function Year({ app }: { app: AppState }) {
  const current = fiscalYearOf(today());
  const first = Math.min(current, ...app.snap.rows.map(r => fiscalYearOf(r.date)));
  const [fy, setFy] = useState(current);
  const r = yearReport(app.snap.rows, fy);
  return (
    <>
      <Stepper label={`${fy}年度（4月〜3月）`} prev={fy > first ? () => setFy(fy - 1) : undefined} next={fy < current ? () => setFy(fy + 1) : undefined} />
      <div className="card tint">
        <h2>記録ベース収支</h2>
        <div className={`big num ${r.total.balance < 0 ? 'over' : ''}`}>{yen(r.total.balance)}</div>
        <Line label="収入" value={yen(r.total.income)} /><Line label="支出" value={yen(r.total.expense)} /><Line label="先取り貯金・投資" value={yen(r.total.saving)} />
      </div>
      <table className="yeartable num">
        <thead><tr><th scope="col">月</th><th scope="col">収入</th><th scope="col">支出</th><th scope="col">収支</th></tr></thead>
        <tbody>
          {r.months.map(m => (
            <tr key={m.ym}><th scope="row">{monthLabel(m.ym)}</th><td>{m.income.toLocaleString('ja-JP')}</td><td>{m.expense.toLocaleString('ja-JP')}</td><td className={m.balance < 0 ? 'over' : ''}>{m.balance.toLocaleString('ja-JP')}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="hint">登録済み明細の集計です。口座残高・貯蓄残高ではありません。</p>
    </>
  );
}

function Special({ app }: { app: AppState }) {
  const s = app.snap.special;
  if (!s) return <p className="muted section">未設定です。スプレッドシートと同期すると表示されます。</p>;
  return (
    <>
      <div className="card tint">
        <h2>今使える確保残高</h2>
        <div className="big num">{money(s.balance)}</div>
        <Line label="実際の積立（開始後）" value={money(s.saved)} /><Line label="積立から充当（開始後）" value={money(s.used)} /><Line label="積立以外からの支出" value={money(s.outside)} />
      </div>
      <section className="section">
        <div className="card">
          <Line label="年間予定額" value={money(s.planned)} /><Line label="年間支出実績" value={money(s.actual)} /><Line label="毎月の積立計画" value={money(s.monthlyPlan)} />
        </div>
      </section>
      {s.months.length > 0 && (
        <table className="yeartable num">
          <thead><tr><th scope="col">月</th><th scope="col">予定</th><th scope="col">実績</th></tr></thead>
          <tbody>{s.months.map(m => <tr key={m.label}><th scope="row">{m.label}</th><td>{money(m.plan)}</td><td>{money(m.actual)}</td></tr>)}</tbody>
        </table>
      )}
    </>
  );
}

export function Reports({ app, tab, onTab, onClose }: { app: AppState; tab: ReportTab | null; onTab: (t: ReportTab) => void; onClose: () => void }) {
  const unsent = app.ops.length;
  return (
    <Sheet open={tab !== null} onOpenChange={o => { if (!o) onClose(); }} title="集計">
      <div className="filters" role="group" aria-label="集計の種類">
        {TABS.map(([t, label]) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => onTab(t)}>{label}</button>)}
      </div>
      {unsent > 0 && <p className="hint">未送信 {unsent}件は含みません</p>}
      {tab === 'month' && <Month app={app} />}
      {tab === 'year' && <Year app={app} />}
      {tab === 'special' && <Special app={app} />}
    </Sheet>
  );
}
