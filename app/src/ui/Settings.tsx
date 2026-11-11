import { Check, CircleAlert, FileUp, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { slash } from '../lib/date';
import { demoApi } from '../lib/demo';
import { displayName, iconFor, KUBUN_LABEL, yen } from '../lib/display';
import type { AppState } from '../lib/store';
import { KUBUN, type Op } from '../lib/types';
import { NmdMark } from './Home';
import { BusyVeil, Sheet } from './Sheet';
import { Csv } from './Csv';
import { MasterEdit } from './MasterEdit';

const NMD_ICONS = ['lucide:sprout', 'lucide:leaf', 'lucide:star', 'lucide:smile', 'lucide:circle-check', 'lucide:heart'];
const STATE_LABEL: Record<Op['state'], string> = { pending: '未送信', unknown: '送信確認中', failed: '受付不可' };

export function Settings({ app, onEdit }: { app: AppState; onEdit: (op: Op) => void }) {
  const [editing, setEditing] = useState(false);
  const [csv, setCsv] = useState(false);
  const { conn, prefs, snap, ops } = app;
  const [url, setUrl] = useState(conn.url);
  const [code, setCode] = useState('');
  const [pairErr, setPairErr] = useState('');
  const [pairing, setPairing] = useState(false);
  const [emoji, setEmoji] = useState(prefs.nmdIcon.startsWith('lucide:') ? '' : prefs.nmdIcon);
  const [, force] = useState(0);
  const [pressing, setPressing] = useState(false);
  const [result, setResult] = useState<{ text: string; kind: string; at?: string } | null>(null);

  const himoku = snap.master.items.filter(i => i.kubun === '支出（変動費）').map(i => i.himoku);
  const methods = [...new Set([...prefs.quickMethods, prefs.defaultMethod, ...snap.master.methods])];
  const oldest = ops[0] ? Math.floor((Date.now() - ops[0].createdAt) / 864e5) : 0;

  // 一瞬で終わっても「押せた」と分かるよう、回転表示を最低0.6秒見せてから結果を出す
  async function runSync() {
    setPressing(true); setResult(null);
    const [r] = await Promise.all([app.sync(true), new Promise(ok => setTimeout(ok, 600))]);
    const n = new Date();
    setResult(r ? { ...r, at: `${n.getHours()}:${String(n.getMinutes()).padStart(2, '0')}` } : { text: 'ほかの同期が終わるのを待っています', kind: 'info' });
    setPressing(false);
  }

  async function pair() {
    setPairErr('');
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url.trim())) { setPairErr('ウェブアプリのURL（…/exec）を入力してください'); return; }
    if (!/^\d{6}$/.test(code)) { setPairErr('6桁の接続コードを入力してください'); return; }
    setPairing(true);
    setPairErr(await app.pair(url.trim(), code));
    setPairing(false); setCode('');
  }

  return (
    <div>
      <h2 className="h">同期</h2>
      <div className="list">
        <div className="li"><span>接続先</span><span className="tag">{conn.mode === 'demo' ? 'デモ（架空データ）' : conn.device ? 'スプレッドシート' : '未接続'}</span></div>
        <div className="li"><span>最終同期</span><span className="num">{app.lastSync || 'まだありません'}</span></div>
        <div className="li"><span>未送信</span><span className="num">{ops.length}件</span></div>
        <div className="li">
          <span className={`syncresult ${result?.kind === 'error' ? 'bad' : result ? 'ok' : ''}`} role="status">
            {pressing ? '' : result ? <>{result.kind === 'error' ? <CircleAlert size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}{result.text}{result.at ? `（${result.at}）` : ''}</>
              : app.online ? '' : 'オフライン'}
          </span>
          {pressing && <BusyVeil text="同期しています" />}
          <button type="button" className="secondary" onClick={runSync} disabled={pressing || app.syncing}>
            <RefreshCw size={16} strokeWidth={2} aria-hidden="true" className={pressing || app.syncing ? 'spin' : ''} /> {pressing ? '同期中…' : '今すぐ同期'}
          </button>
        </div>
      </div>
      {oldest >= 3 && <p className="err"><CircleAlert size={16} />{oldest}日前から未送信の取引があります。端末のデータを消すと失われます</p>}
      {ops.length > 0 && (
        <div className="list" style={{ marginTop: 16 }} aria-label="未送信の取引">
          {ops.map(o => (
            <div className="li" key={o.opId}>
              <div className="grow">
                <div>{slash(o.tx.date)}　{displayName(o.tx.himoku)}　<span className="num">{yen(o.tx.amount)}</span></div>
                <div className="muted">{o.tx.method}{o.tx.place ? '・' + o.tx.place : ''}・<span className="tag">{o.type === 'update' ? '修正・' : o.type === 'delete' ? '削除・' : ''}{STATE_LABEL[o.state]}</span>
                  {o.error ? `（${o.error}）` : ''}</div>
              </div>
              {o.state !== 'unknown' && <>
                {o.type === 'add' && <button type="button" className="secondary" onClick={() => onEdit(o)}>修正</button>}
                <button type="button" className="secondary danger" onClick={() => confirm('この未送信の取引を取り消しますか？') && app.removeOp(o.opId)}>取消</button>
              </>}
            </div>
          ))}
        </div>
      )}

      <h2 className="h">CSV取込</h2>
      <button type="button" className="secondary" style={{ width: '100%' }} onClick={() => setCsv(true)}><FileUp size={20} strokeWidth={2} aria-hidden="true" />カード明細のCSVを取り込む</button>
      <Sheet open={csv} onOpenChange={setCsv} title="CSV取込"><Csv app={app} /></Sheet>

      <h2 className="h">接続</h2>
      <div className="list">
        <label className="li"><span>デモで試す</span>
          <input type="checkbox" style={{ width: 24, height: 24 }} checked={conn.mode === 'demo'}
            onChange={e => app.saveConn({ ...conn, mode: e.target.checked ? 'demo' : 'sheet' })} /></label>
      </div>
      {conn.mode === 'sheet' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="field" style={{ marginTop: 0 }}>
            <label htmlFor="url">連携先URL</label>
            <input id="url" className="input" inputMode="url" value={url} onChange={e => setUrl(e.target.value)} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="code">接続コード（スプレッドシートのメニュー「アプリ」で発行）</label>
            <input id="code" className="input num" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" />
          </div>
          {pairErr && <p className="err" style={{ marginTop: 8 }}><CircleAlert size={16} />{pairErr}</p>}
          <button type="button" className="primary" onClick={pair} disabled={pairing}>{conn.device ? '接続し直す' : '接続する'}</button>
        </div>
      )}
      {conn.mode === 'demo' && (
        <div className="list" style={{ marginTop: 16 }} aria-label="デモの通信状態">
          <label className="li"><span>通信を切る</span>
            <input type="checkbox" style={{ width: 24, height: 24 }} defaultChecked={demoApi.offline} onChange={e => { demoApi.offline = e.target.checked; force(x => x + 1); }} /></label>
          <label className="li"><span>次の送信で応答を失う</span>
            <input type="checkbox" style={{ width: 24, height: 24 }} defaultChecked={demoApi.loseNextResponse} onChange={e => { demoApi.loseNextResponse = e.target.checked; }} /></label>
        </div>
      )}

      <h2 className="h">入力の初期値</h2>
      <div className="list">
        <label className="li"><span>費目</span>
          <select className="input" style={{ width: 'auto' }} value={prefs.defaultHimoku} onChange={e => app.savePrefs({ ...prefs, defaultHimoku: e.target.value })}>
            {[...new Set([prefs.defaultHimoku, ...himoku])].map(h => <option key={h} value={h}>{displayName(h)}</option>)}
          </select></label>
        <label className="li"><span>支払方法</span>
          <select className="input" style={{ width: 'auto' }} value={prefs.defaultMethod} onChange={e => app.savePrefs({ ...prefs, defaultMethod: e.target.value })}>
            {methods.map(m => <option key={m}>{m}</option>)}
          </select></label>
        {[0, 1, 2].map(i => (
          <label className="li" key={i}><span>クイック選択 {i + 1}</span>
            <select className="input" style={{ width: 'auto' }} value={prefs.quickMethods[i] ?? ''}
              onChange={e => { const q = [...prefs.quickMethods]; q[i] = e.target.value; app.savePrefs({ ...prefs, quickMethods: q }); }}>
              {methods.map(m => <option key={m}>{m}</option>)}
            </select></label>
        ))}
      </div>

      <h2 className="h">変動費0円の日のマーク</h2>
      <div className="chips" role="group" aria-label="マーク">
        {NMD_ICONS.map(i => (
          <button key={i} type="button" className="chip" aria-pressed={prefs.nmdIcon === i} aria-label={i.slice(7)}
            onClick={() => app.savePrefs({ ...prefs, nmdIcon: i })}><NmdMark icon={i} /></button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="emoji">絵文字で表示する</label>
        <div className="datebox">
          <input id="emoji" className="input" value={emoji} onChange={e => setEmoji(e.target.value)} />
          <button type="button" className="secondary" disabled={!emoji.trim()} onClick={() => app.savePrefs({ ...prefs, nmdIcon: [...emoji.trim()][0] ? emoji.trim() : prefs.nmdIcon })}>使う</button>
        </div>
      </div>

      <h2 className="h">費目・予算・支払方法</h2>
      <button type="button" className="secondary" style={{ width: '100%', marginTop: 8 }} disabled={!app.api || !app.online} onClick={() => setEditing(true)}>費目・予算・支払方法を変更する</button>
      <MasterEdit app={app} open={editing} onClose={() => setEditing(false)} />
      {!snap.master.items.length ? <p className="muted">スプレッドシートの取得前です</p> : (
        <div className="list" style={{ marginTop: 8 }}>
          {KUBUN.map(k => snap.master.items.filter(i => i.kubun === k).sort((a, b) => a.order - b.order).map(i => {
            const I = iconFor(i.himoku);
            return (
              <div className="li" key={k + i.himoku}>
                <I size={20} strokeWidth={2} aria-hidden="true" />
                <span className="grow">{displayName(i.himoku)} <span className="muted">{KUBUN_LABEL[k]}</span></span>
                {i.weekly && <span className="tag">週</span>}
                <span className="num muted">{i.budget ? yen(i.budget) : ''}</span>
              </div>
            );
          }))}
        </div>
      )}
    </div>
  );
}
