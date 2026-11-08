import { CircleAlert, CloudOff, FileSpreadsheet, House, List, Settings as Gear } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useApp } from './lib/store';
import type { Op } from './lib/types';
import { Home } from './ui/Home';
import { Settings } from './ui/Settings';

type Tab = 'home' | 'list' | 'csv' | 'settings';
const TABS: [Tab, string, typeof House][] = [['home', 'ホーム', House], ['list', '明細', List], ['csv', 'CSV', FileSpreadsheet], ['settings', '設定', Gear]];

export function App() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('home');
  const [editing, setEditing] = useState<Op | null>(null);
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

      <main>
        {tab === 'home' && <Home app={app} editing={editing} onDoneEditing={() => setEditing(null)} />}
        {tab === 'settings' && <Settings app={app} onEdit={op => { setEditing(op); setTab('home'); }} />}
        {(tab === 'list' || tab === 'csv') && <p className="muted section">この画面は次の段階で作ります。</p>}
      </main>

      {app.notice && (
        <div className="toast" role="status">
          {app.notice.kind === 'error' && <CircleAlert size={16} aria-hidden="true" />}
          <span>{app.notice.text}</span>
          {app.notice.retry && <button type="button" onClick={() => { app.setNotice(null); app.sync(true); }}>再試行</button>}
        </div>
      )}

      <nav className="nav" aria-label="画面">
        {TABS.map(([t, label, I]) => (
          <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
            <I size={24} strokeWidth={2} aria-hidden="true" />{label}
          </button>
        ))}
      </nav>
    </div>
  );
}
