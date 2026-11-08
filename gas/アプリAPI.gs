/**
 * 家計簿_ver3.0｜アプリAPI（試作）
 *
 * スプレッドシートを正本とし、アプリからは「取引の追加・修正・削除」を受け付けます。
 * 既存のカード明細取込（コード.gs）と同じプロジェクトに置き、同じドキュメントロック・同じ書込順を使います。
 *
 * 設置（テスト用コピーで行う）：
 *   1. 旧同期ファイル（アプリ連携.gs）を削除する（doPost が2つあると動作が不定になるため）
 *   2. このファイルを追加して保存
 *   3. デプロイ → 新しいデプロイ → ウェブアプリ（実行：自分／アクセス：全員）
 *   4. スプレッドシートを開き直し、メニュー「アプリ」→「接続コードを発行」
 *
 * 認証：アクセス「全員」で公開するため、API 内で端末ごとの鍵を確認します。
 *   鍵は接続コード（10分・1回限り・5回失敗で無効）と交換で発行し、サーバーにはハッシュのみ保存します。
 */
const KKB_API = Object.freeze({
  RAW_SHEET: '01_Raw_Data',
  LEDGER_SHEET: '_AppSync',
  FIRST_ROW: 5,
  LAST_ROW: 4986,            // 01_Raw_Data の数式・候補が用意されている最終行
  PAIR_KEY: 'kkbApiPair',
  DEVICE_PREFIX: 'kkbApiDevice_',
  LEDGER_HEADER: ['操作ID', '取引ID', '処理', '行', '内容ハッシュ', '処理日時', '端末'],
  SATISFACTION: ['◯', '△', '✕', 'ー'],
  KUBUN: ['収入', '先取り貯金・投資', '支出（固定費）', '支出（変動費）', '支出（特別費）'],
});

// ---------- メニュー（スプレッドシート側の操作） ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('アプリ')
    .addItem('接続コードを発行', 'kkbApiIssuePairCode')
    .addItem('接続中の端末を確認', 'kkbApiListDevices')
    .addItem('すべての端末の接続を解除', 'kkbApiRevokeAll')
    .addToUi();
}

function kkbApiIssuePairCode() {
  const code = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  PropertiesService.getScriptProperties().setProperty(KKB_API.PAIR_KEY, JSON.stringify({
    hash: kkbApiHash_(code), expires: Date.now() + 10 * 60 * 1000, attempts: 0,
  }));
  SpreadsheetApp.getUi().alert('接続コード', code + '\n\nアプリの設定で入力してください。10分間・1回だけ有効です。',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function kkbApiListDevices() {
  const devices = kkbApiDevices_();
  const lines = devices.map(d => '・' + d.name + '（登録 ' + d.created + '／最終利用 ' + (d.lastUsed || '—') + '）');
  SpreadsheetApp.getUi().alert('接続中の端末', lines.join('\n') || 'ありません', SpreadsheetApp.getUi().ButtonSet.OK);
}

function kkbApiRevokeAll() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('すべての端末の接続を解除しますか？', '解除した端末は、接続コードを入れ直すまで同期できません。端末に残っている未送信の取引は消えません。',
    ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).filter(k => k.indexOf(KKB_API.DEVICE_PREFIX) === 0).forEach(k => props.deleteProperty(k));
  ui.alert('解除しました');
}

// ---------- 受付 ----------

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return kkbApiJson_({ ok: false, error: 'bad_request' }); }
  try {
    if (req.action === 'pair') return kkbApiJson_(kkbApiPair_(req));
    const device = kkbApiAuth_(req.device);
    if (!device) return kkbApiJson_({ ok: false, error: 'unauthorized' });
    // カード明細取込と同じドキュメントロックで、01_Raw_Data への書込を直列化する
    const lock = LockService.getDocumentLock();
    if (!lock.tryLock(25000)) return kkbApiJson_({ ok: false, error: 'busy' });
    try {
      const ss = SpreadsheetApp.getActive();
      if (req.action === 'pull') return kkbApiJson_(kkbApiPull_(ss));
      if (req.action === 'push') return kkbApiJson_(kkbApiPush_(ss, req.ops || [], device));
      return kkbApiJson_({ ok: false, error: 'unknown_action' });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return kkbApiJson_({ ok: false, error: 'server', message: String(err && err.message || err) });
  }
}

function kkbApiPair_(req) {
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
  try {
    const pair = JSON.parse(props.getProperty(KKB_API.PAIR_KEY) || 'null');
    if (!pair || Date.now() > pair.expires || pair.attempts >= 5) return { ok: false, error: 'pair_expired' };
    if (kkbApiHash_(String(req.code || '')) !== pair.hash) {
      pair.attempts++;
      props.setProperty(KKB_API.PAIR_KEY, JSON.stringify(pair));
      return { ok: false, error: 'pair_wrong' };
    }
    props.deleteProperty(KKB_API.PAIR_KEY);   // 1回限り
    const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    const now = kkbApiNow_();
    props.setProperty(KKB_API.DEVICE_PREFIX + kkbApiHash_(token),
      JSON.stringify({ name: String(req.deviceName || '端末').slice(0, 40), created: now, lastUsed: now }));
    return { ok: true, token: token };
  } finally {
    lock.releaseLock();
  }
}

function kkbApiAuth_(token) {
  if (!token || typeof token !== 'string') return null;
  const props = PropertiesService.getScriptProperties();
  const key = KKB_API.DEVICE_PREFIX + kkbApiHash_(token);
  const raw = props.getProperty(key);
  if (!raw) return null;
  const device = JSON.parse(raw);
  device.lastUsed = kkbApiNow_();
  props.setProperty(key, JSON.stringify(device));
  return device;
}

function kkbApiDevices_() {
  const all = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(all).filter(k => k.indexOf(KKB_API.DEVICE_PREFIX) === 0).map(k => JSON.parse(all[k]));
}

// ---------- 取得 ----------

function kkbApiPull_(ss) {
  const raw = requireSheetV3_(ss, KKB_API.RAW_SHEET);
  const tz = ss.getSpreadsheetTimeZone();
  // 削除で途中に空行ができるので、最初の空行で止めず最終行まで読む
  const count = Math.max(raw.getLastRow() - KKB_API.FIRST_ROW + 1, 0);
  const values = count > 0 ? raw.getRange(KKB_API.FIRST_ROW, 2, count, 8).getValues() : [];   // B:I

  // 台帳：アプリから追加した行の「内容ハッシュ → 取引ID」
  const byHash = {};
  kkbApiLedgerRows_(ss).forEach(r => { if (r.type === 'add' && r.hash) (byHash[r.hash] = byHash[r.hash] || []).push(r.txId); });

  const seen = {};
  const rows = [];
  values.forEach((v, i) => {
    const row = kkbApiNormalizeRow_(v, tz);
    if (!row) return;
    const hash = kkbApiRowHash_(row);
    const n = seen[hash] = (seen[hash] || 0) + 1;
    const fromApp = byHash[hash] && byHash[hash].shift();
    rows.push(Object.assign(row, { id: fromApp || ('s:' + hash + ':' + n), hash: hash, row: KKB_API.FIRST_ROW + i }));
  });

  return {
    ok: true,
    serverTime: kkbApiNow_(),
    rows: rows,
    master: kkbApiMaster_(ss),
    capacity: { used: rows.length, max: KKB_API.LAST_ROW - KKB_API.FIRST_ROW + 1 },
  };
}

// 96_Drop_Down（G:O）と費目管理（週管理・入出金方法）を読む。値の変更はしない。
function kkbApiMaster_(ss) {
  const dd = requireSheetV3_(ss, '96_Drop_Down');
  const n = Math.max(dd.getLastRow() - 1, 0);
  const items = [];
  const index = {};
  (n ? dd.getRange(2, 7, n, 9).getValues() : []).forEach(r => {   // G:O
    const kubun = String(r[0] || '').trim(), himoku = String(r[1] || '').trim();
    if (!kubun || !himoku || KKB_API.KUBUN.indexOf(kubun) < 0) return;
    const key = kubun + '|' + himoku;
    if (index[key]) { index[key].budget += Number(r[6]) || 0; return; }
    const item = { kubun: kubun, himoku: himoku, note: String(r[2] || '').trim(),
      methods: String(r[3] || '').split('・').map(s => s.trim()).filter(Boolean),
      budget: Number(r[6]) || 0, group: String(r[7] || '').trim() || himoku, order: Number(r[8]) || 999, weekly: false };
    index[key] = item;
    items.push(item);
  });

  const fm = requireSheetV3_(ss, '費目管理');
  const fmRows = fm.getRange(1, 1, fm.getLastRow(), 17).getValues();   // A:Q
  fmRows.forEach(r => {
    const name = String(r[8] || '').trim() || String(r[11] || '').trim();   // I（なければ L）
    const item = index['支出（変動費）|' + name];
    if (item && (r[15] === true || String(r[15]).toUpperCase() === 'TRUE')) item.weekly = true;   // P
  });
  const methods = [];
  fmRows.slice(2).forEach(r => {   // Q列：3行目以降が入出金方法マスター
    const m = String(r[16] || '').trim();
    if (m && methods.indexOf(m) < 0) methods.push(m);
  });
  return { items: items, methods: methods };
}

// ---------- 追加 ----------

function kkbApiPush_(ss, ops, device) {
  const ledger = kkbApiLedgerSheet_(ss);
  const done = {};
  kkbApiLedgerRows_(ss).forEach(r => { done[r.opId] = r; });
  const raw = requireSheetV3_(ss, KKB_API.RAW_SHEET);
  const tz = ss.getSpreadsheetTimeZone();
  const results = [];

  ops.forEach(op => {
    if (!op || !op.opId) { results.push({ opId: null, status: 'error', error: 'bad_op' }); return; }
    // 同じ操作IDは、前回と同じ結果を返す（応答が届かなかった再送でも増えない）
    if (done[op.opId]) { results.push({ opId: op.opId, status: 'done', txId: done[op.opId].txId, row: done[op.opId].row, repeated: true }); return; }
    if (op.type === 'update' || op.type === 'delete') { results.push(kkbApiEdit_(raw, ledger, tz, op, device)); return; }
    if (op.type !== 'add') { results.push({ opId: op.opId, status: 'error', error: 'unsupported' }); return; }

    const tx = op.tx || {};
    const problem = kkbApiValidate_(tx);
    if (problem) { results.push({ opId: op.opId, status: 'error', error: 'invalid', message: problem }); return; }

    const row = findFirstBlankByColumn_(raw, KKB_API.FIRST_ROW, 2);
    if (row > KKB_API.LAST_ROW) { results.push({ opId: op.opId, status: 'error', error: 'full' }); return; }

    const date = Utilities.parseDate(tx.date, tz, 'yyyy-MM-dd');   // 日付だけの値をシートの時差で解釈
    const g = kkbApiPlaceDetail_(tx.place, tx.detail);
    const sat = tx.sat && KKB_API.SATISFACTION.indexOf(tx.sat) >= 0 ? tx.sat : 'ー';
    // コード.gs（applyApprovedCardRows）と同じ順：区分を含む列 → 費目候補の再計算 → 費目
    raw.getRange(row, 2, 1, 3).setValues([[date, Number(tx.amount), tx.kubun]]);
    raw.getRange(row, 6, 1, 4).setValues([[tx.method, g, sat, '手入力']]);
    raw.getRange(row, 12).setValue(new Date());
    SpreadsheetApp.flush();
    raw.getRange(row, 5).setValue(tx.himoku);
    SpreadsheetApp.flush();

    const written = kkbApiNormalizeRow_(raw.getRange(row, 2, 1, 8).getValues()[0], tz);
    const hash = kkbApiRowHash_(written);
    const entry = [op.opId, tx.id, 'add', row, hash, new Date(), device.name];
    ledger.appendRow(entry);
    done[op.opId] = { opId: op.opId, txId: tx.id, row: row };
    results.push({ opId: op.opId, status: 'done', txId: tx.id, row: row });
  });
  return { ok: true, results: results };
}

// ---------- 送信済み取引の修正・削除 ----------

/**
 * 取得時の内容ハッシュと今の行が一致するときだけ書き換える。スプレッドシートで変更されていれば conflict を返し、上書きしない。
 * 削除は B:I と L だけを空にする。行そのものを消すと数式の範囲がずれるため、行は残す（空行は次の追加で再利用される）。
 */
function kkbApiEdit_(raw, ledger, tz, op, device) {
  const target = op.target || {};
  const row = kkbApiFindRow_(raw, tz, target);
  if (row < 0) return { opId: op.opId, status: 'error', error: 'conflict' };
  let hash = '';
  if (op.type === 'delete') {
    raw.getRange(row, 2, 1, 8).clearContent();
    raw.getRange(row, 12).clearContent();
    SpreadsheetApp.flush();
  } else {
    const tx = op.tx || {};
    const problem = kkbApiValidate_(tx);
    if (problem) return { opId: op.opId, status: 'error', error: 'invalid', message: problem };
    const sat = tx.sat && KKB_API.SATISFACTION.indexOf(tx.sat) >= 0 ? tx.sat : 'ー';
    // 追加と同じ順：区分 → 費目候補の再計算 → 費目。データ元（I列）と登録日時（L列）は変えない。
    raw.getRange(row, 2, 1, 3).setValues([[Utilities.parseDate(tx.date, tz, 'yyyy-MM-dd'), Number(tx.amount), tx.kubun]]);
    raw.getRange(row, 6, 1, 3).setValues([[tx.method, kkbApiPlaceDetail_(tx.place, tx.detail), sat]]);
    SpreadsheetApp.flush();
    raw.getRange(row, 5).setValue(tx.himoku);
    SpreadsheetApp.flush();
    hash = kkbApiRowHash_(kkbApiNormalizeRow_(raw.getRange(row, 2, 1, 8).getValues()[0], tz));
  }
  ledger.appendRow([op.opId, target.id || '', op.type, row, hash, new Date(), device.name]);
  return { opId: op.opId, status: 'done', txId: target.id, row: row };
}

// 行番号は目安。その行の内容が違えば同じ内容の行を探し、1行に決まらないときは -1
function kkbApiFindRow_(raw, tz, target) {
  if (!target.hash) return -1;
  const count = Math.max(raw.getLastRow() - KKB_API.FIRST_ROW + 1, 0);
  if (!count) return -1;
  const values = raw.getRange(KKB_API.FIRST_ROW, 2, count, 8).getValues();
  const same = i => {
    const r = values[i] && kkbApiNormalizeRow_(values[i], tz);
    return !!r && kkbApiRowHash_(r) === target.hash;
  };
  const hint = Number(target.row) - KKB_API.FIRST_ROW;
  if (same(hint)) return KKB_API.FIRST_ROW + hint;
  const found = [];
  values.forEach((_, i) => { if (same(i)) found.push(KKB_API.FIRST_ROW + i); });
  return found.length === 1 ? found[0] : -1;
}

function kkbApiValidate_(tx) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tx.date || ''))) return '日付';
  if (!Number.isFinite(Number(tx.amount)) || Number(tx.amount) === 0) return '金額';
  if (KKB_API.KUBUN.indexOf(tx.kubun) < 0) return '区分';
  if (!tx.himoku) return '費目';
  if (!tx.method) return '支払方法';
  if (!tx.id) return '取引ID';
  return '';
}

// 既存の G 列（詳細）は CSV 照合キーに使われるため、利用先を先頭に置く
function kkbApiPlaceDetail_(place, detail) {
  place = String(place || '').trim(); detail = String(detail || '').trim();
  return place && detail ? place + '／' + detail : place || detail;
}

// ---------- 共通 ----------

function kkbApiNormalizeRow_(v, tz) {
  let date = v[0];
  if (date instanceof Date) date = Utilities.formatDate(date, tz, 'yyyy-MM-dd');
  else {
    const m = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/.exec(String(date || '').trim());
    if (!m) return null;
    date = m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }
  const amount = Number(String(v[1]).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(amount) || String(v[1]).trim() === '') return null;
  const s = i => String(v[i] == null ? '' : v[i]).trim();
  return { date: date, amount: amount, kubun: s(2), himoku: s(3), method: s(4), g: s(5), sat: s(6), source: s(7) };
}

function kkbApiRowHash_(r) {
  return kkbApiHash_([r.date, r.amount, r.kubun, r.himoku, r.method, r.g, r.sat, r.source].join('\u001f')).slice(0, 16);
}

function kkbApiHash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}

function kkbApiLedgerSheet_(ss) {
  let s = ss.getSheetByName(KKB_API.LEDGER_SHEET);
  if (!s) { s = ss.insertSheet(KKB_API.LEDGER_SHEET); s.hideSheet(); }
  const head = s.getRange(1, 1, 1, KKB_API.LEDGER_HEADER.length).getValues()[0];
  if (head[0] !== KKB_API.LEDGER_HEADER[0]) {
    // 旧同期（アプリ連携.gs）の控えが残っていれば作り替える。旧同期を止めてから使うこと。
    s.clearContents();
    s.getRange(1, 1, 1, KKB_API.LEDGER_HEADER.length).setValues([KKB_API.LEDGER_HEADER]);
  }
  return s;
}

function kkbApiLedgerRows_(ss) {
  const s = kkbApiLedgerSheet_(ss);
  const n = s.getLastRow() - 1;
  if (n <= 0) return [];
  return s.getRange(2, 1, n, 5).getValues().map(r => ({ opId: String(r[0]), txId: String(r[1]), type: String(r[2]), row: Number(r[3]), hash: String(r[4]) }));
}

function kkbApiNow_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
}

function kkbApiJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
