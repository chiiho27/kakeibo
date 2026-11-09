import { CircleAlert, CloudOff, FileSpreadsheet, House, List, Plus, Settings as Gear } from 'lucide-react';
import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useApp } from './lib/store';
import type { Op, SheetRow } from './lib/types';
import { List as ListScreen } from './ui/List';
import { Csv } from './ui/Csv';
import { EntryForm } from './ui/EntryForm';
import { Home } from './ui/Home';
import { Reports, type ReportTab } from './ui/Reports';
import { Settings } from './ui/Settings';

type Tab = 'home' | 'list' | 'csv' | 'settings';
const TABS: [Tab, string, typeof House][] = [['home', 'ホーム', House], ['list', '明細', List], ['csv', 'CSV', FileSpreadsheet], ['settings', '設定', Gear]];

export function App() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('home');
  const [editing, setEditing] = useState<Op | null>(null);
  const [editRow, setEditRow] = useState<SheetRow | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [report, setReport] = useState<ReportTab | null>(null);
  const [slide, setSlide] = useState('');
  const swipe = useRef<{ x: number; y: number } | null>(null);

  // 画面を左右になでるとタブを切り替える。入力欄の上では文字の選択やスクロールを優先する。
  const swipeStart = (e: TouchEvent) => {
    const t = e.touches[0];
    swipe.current = (e.target as HTMLElement).closest('input,select,textarea') ? null : { x: t.clientX, y: t.clientY };
  };
  const swipeEnd = (e: TouchEvent) => {
    if (!swipe.current) return;
    const t = e.changedTouches[0], dx = t.clientX - swipe.current.x, dy = t.clientY - swipe.current.y;
    swipe.current = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > 45) return;
    const next = TABS[TABS.findIndex(x => x[0] === tab) + (dx < 0 ? 1 : -1)];
    if (next) { setSlide(dx < 0 ? 'from-right' : 'from-left'); setTab(next[0]); window.scrollTo(0, 0); }
  };
  // 新しい版は「更新」を押すまで適用しない。更新しても端末の未送信データは消えない。
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  useEffect(() => {
    if (!app.notice) return;
    const t = setTimeout(() => app.setNotice(null), app.notice.retry ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [app.notice]); // eslint-disable-line

  if (!app.ready) return null;
  const unsent = app.ops.length;

  return (
    <div className="app">
      <header className="topbar">
        <h1>{TABS.find(t => t[0] === tab)![1]}</h1>
        <div className={`status ${!app.online || app.ops.some(o => o.state === 'failed') ? 'warn' : ''}`} role="status">
          {app.conn.mode === 'demo' && <span className="tag">デモ</span>}
          {!app.online && <><CloudOff size={16} aria-hidden="true" />オフライン</>}
          {unsent > 0 ? <span>未送信 {unsent}件</span> : app.lastSync ? <span>最終同期 {app.lastSync}</span> : null}
        </div>
      </header>
      {needRefresh && (
        <div className="row card tint" style={{ alignItems: 'center' }}>
          <span>新しい版があります</span>
          <button type="button" className="secondary" onClick={() => updateServiceWorker(true)}>更新</button>
        </div>
      )}
      {app.conn.mode === 'sheet' && !app.conn.device && (
        <p className="err"><CircleAlert size={16} />スプレッドシートに未接続です。設定で接続してください</p>
      )}

      <main key={tab} className={slide} onTouchStart={swipeStart} onTouchEnd={swipeEnd}>
        {tab === 'home' && <Home app={app} onReport={setReport} />}
        {tab === 'settings' && <Settings app={app} onEdit={op => { setEditing(op); setEntryOpen(true); }} />}
        {tab === 'list' && <ListScreen app={app} onEditRow={r => { setEditing(null); setEditRow(r); setEntryOpen(true); }} onEditOp={op => { setEditRow(null); setEditing(op); setEntryOpen(true); }} />}
        {tab === 'csv' && <Csv app={app} />}
      </main>

      {app.notice && (
        <div className={`toast ${entryOpen ? 'top' : ''}`} role="status">
          {app.notice.kind === 'error' && <CircleAlert size={16} aria-hidden="true" />}
          <span>{app.notice.text}</span>
          {app.notice.retry && <button type="button" onClick={() => { app.setNotice(null); app.sync(true); }}>再試行</button>}
        </div>
      )}

      <nav className="nav" aria-label="画面">
        {TABS.flatMap(([t, label, I], i) => [
          ...(i === 2 ? [<button key="add" type="button" className="add" aria-label="入力" onClick={() => { setEditing(null); setEditRow(null); setEntryOpen(true); }}>
            <span><Plus size={24} strokeWidth={2} aria-hidden="true" /></span></button>] : []),
          <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => { setSlide(''); setTab(t); }}>
            <I size={24} strokeWidth={2} aria-hidden="true" />{label}
          </button>,
        ])}
      </nav>

      <Reports app={app} tab={report} onTab={setReport} onClose={() => setReport(null)} />
      <EntryForm app={app} editing={editing} editRow={editRow} open={entryOpen} onClose={() => { setEntryOpen(false); setEditing(null); setEditRow(null); }} />
    </div>
  );
}
