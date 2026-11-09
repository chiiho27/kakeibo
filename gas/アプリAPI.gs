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
    .addItem('費目管理の構造を書き出す（読み取りのみ）', 'kkbApiInspectMaster')
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
      if (req.action === 'csvRead') return kkbApiJson_(kkbApiCsvRead_(ss, req.files || []));
      if (req.action === 'csvList') return kkbApiJson_(kkbApiCsvList_(ss));
      if (req.action === 'csvApply') return kkbApiJson_(kkbApiCsvApply_(ss, req.items || []));
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
    special: kkbApiSpecial_(ss),
    capacity: { used: rows.length, max: KKB_API.LAST_ROW - KKB_API.FIRST_ROW + 1 },
  };
}

// 特別費管理の表示値を見出しで探して返す（読み取りのみ）。残高はシートの数式の結果をそのまま使う。
function kkbApiSpecial_(ss) {
  const sh = ss.getSheetByName('特別費管理');
  if (!sh) return null;
  const tz = ss.getSpreadsheetTimeZone();
  const v = sh.getRange(1, 1, Math.min(sh.getLastRow(), 40), 4).getValues();
  const num = x => (typeof x === 'number' ? x : null);
  const find = label => { const r = v.find(a => String(a[0]).trim() === label); return r ? num(r[3]) : null; };
  const head = v.findIndex(a => String(a[0]).trim() === '月');
  const months = [];
  if (head >= 0) v.slice(head + 1, head + 13).forEach(a => {
    if (a[0] === '') return;
    months.push({ label: a[0] instanceof Date ? Utilities.formatDate(a[0], tz, 'yyyy/M') : String(a[0]), plan: num(a[1]), actual: num(a[2]) });
  });
  return { balance: find('今使える確保残高'), outside: find('積立以外からの支出'), planned: find('年間予定額'), actual: find('年間支出実績'),
    monthlyPlan: find('毎月の積立計画'), saved: find('実際の積立（開始後）'), used: find('積立から充当（開始後）'), months: months };
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

// ---------- カード明細CSV ----------
// CSVの読み取り・費目推測は コード.gs の関数をそのまま使う。03_Card_Import の J 列（照合・重複判定）の数式も変えない。

const KKB_CSV = Object.freeze({ LAST_ROW: 4011, PENDING: ['要確認', '取込可', 'エラー'], LINK_MARK: '記録済みと確認：Raw行', FORCE_MARK: '別取引として確認' });

function kkbApiDateText_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const m = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/.exec(String(v || '').trim());
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : '';
}
const kkbApiCardKey_ = (date, merchant, amount, method) => [date, Number(amount), method, String(merchant || '').trim()].join('|');

function kkbApiCardRows_(sheet, columns) {
  const n = Math.max(sheet.getLastRow() - KKV3_CARD.FIRST_DATA_ROW + 1, 0);
  return n ? sheet.getRange(KKV3_CARD.FIRST_DATA_ROW, 1, n, columns).getValues() : [];
}

/**
 * CSV を候補として 03_Card_Import に読み込む。
 * 同じ内容の行が既にあれば、その件数分だけ読み飛ばす。ファイル名が違う再ダウンロードや
 * Driveフォルダ経由で読み込み済みの明細は増えず、1ファイル内の同日同額の正当な複数購入は残る。
 */
function kkbApiCsvRead_(ss, files) {
  const sheet = requireSheetV3_(ss, KKV3_CARD.IMPORT_SHEET);
  const tz = ss.getSpreadsheetTimeZone();
  const context = buildCardClassificationContext_(ss);
  const pool = {};
  kkbApiCardRows_(sheet, 6).forEach(r => {
    const d = kkbApiDateText_(r[2], tz);
    if (d) { const k = kkbApiCardKey_(d, r[3], r[4], r[5]); pool[k] = (pool[k] || 0) + 1; }
  });
  const rows = [], errors = [];
  let skipped = 0;
  files.forEach(f => {
    const name = String(f.name || 'card.csv');
    try {
      const bytes = Utilities.base64Decode(String(f.base64 || ''));
      const blob = Utilities.newBlob(bytes, 'text/csv', name);
      const digest = kkbApiHash_(Utilities.base64Encode(bytes)).slice(0, 10);
      const parsed = parseCardCsvFile_({ getName: () => name, getBlob: () => blob });
      if (!parsed.items.length) throw new Error('明細行が見つかりませんでした。');
      const avail = Object.assign({}, pool), adds = {};
      parsed.items.forEach((item, index) => {
        const k = kkbApiCardKey_(kkbApiDateText_(item.usedAt, tz), item.merchant, item.amount, parsed.paymentMethod);
        if (avail[k] > 0) { avail[k]--; skipped++; return; }
        adds[k] = (adds[k] || 0) + 1;
        const c = inferCardClassification_(item.merchant, context);
        rows.push({ importId: 'CARD-A' + digest + '-' + String(index + 1).padStart(4, '0'), usedAt: item.usedAt, merchant: item.merchant, amount: item.amount,
          method: parsed.paymentMethod, category: c.category, fee: c.fee, name: name, note: parsed.note + '／分類：' + c.reason });
      });
      Object.keys(adds).forEach(k => { pool[k] = (pool[k] || 0) + adds[k]; });
    } catch (e) {
      errors.push(name + '：' + e.message);
    }
  });
  if (rows.length) {
    const start = findFirstBlankByColumn_(sheet, KKV3_CARD.FIRST_DATA_ROW, 3);
    if (start + rows.length - 1 > KKB_CSV.LAST_ROW) return { ok: false, error: 'full', message: 'カード明細取込の行数の上限を超えます' };
    // コード.gs（readCardCsvFiles）と同じ順：区分まで → 候補の再計算 → 行ごとの入力規則 → 費目
    const now = new Date();
    sheet.getRange(start, 1, rows.length, 7).setValues(rows.map(r => [r.importId, now, r.usedAt, r.merchant, r.amount, r.method, r.category]));
    sheet.getRange(start, 9, rows.length, 1).setValues(rows.map(() => ['ー']));
    sheet.getRange(start, 11, rows.length, 4).setValues(rows.map(r => ['要確認', 'カードCSV', r.name, r.note]));
    SpreadsheetApp.flush();
    rows.forEach((_, i) => {
      const rule = SpreadsheetApp.newDataValidation().requireValueInRange(sheet.getRange(start + i, 15, 1, 29), true).setAllowInvalid(false).build();
      sheet.getRange(start + i, 8).setDataValidation(rule);
    });
    sheet.getRange(start, 8, rows.length, 1).setValues(rows.map(r => [r.fee]));
    SpreadsheetApp.flush();
  }
  return { ok: true, added: rows.length, skipped: skipped, errors: errors };
}

/** 確認待ちの候補を返す。手入力の詳細が空欄で 日付・金額・支払方法 が同じ取引は、J列とは別に「候補」として示す。 */
function kkbApiCsvList_(ss) {
  const sheet = requireSheetV3_(ss, KKV3_CARD.IMPORT_SHEET);
  const tz = ss.getSpreadsheetTimeZone();
  const all = kkbApiCardRows_(sheet, 14);
  const pending = [];
  const linked = {};
  all.forEach((r, i) => {
    const note = String(r[13] || '');
    const at = note.indexOf(KKB_CSV.LINK_MARK);
    if (at >= 0) linked[parseInt(note.slice(at + KKB_CSV.LINK_MARK.length), 10)] = true;
    if (r[0] && KKB_CSV.PENDING.indexOf(String(r[10]).trim()) >= 0) pending.push({ r: r, row: KKV3_CARD.FIRST_DATA_ROW + i });
  });

  const raw = requireSheetV3_(ss, KKB_API.RAW_SHEET);
  const n = Math.max(raw.getLastRow() - KKB_API.FIRST_ROW + 1, 0);
  const blanks = {};
  (n ? raw.getRange(KKB_API.FIRST_ROW, 2, n, 6).getValues() : []).forEach((v, i) => {
    const row = KKB_API.FIRST_ROW + i, d = kkbApiDateText_(v[0], tz);
    if (d && !String(v[5]).trim() && !linked[row]) { const k = [d, Number(v[1]), String(v[4]).trim()].join('|'); (blanks[k] = blanks[k] || []).push(row); }
  });
  const pendingCount = {};
  pending.forEach(p => { const k = [kkbApiDateText_(p.r[2], tz), Number(p.r[4]), String(p.r[5]).trim()].join('|'); pendingCount[k] = (pendingCount[k] || 0) + 1; });

  const items = pending.map(p => {
    const r = p.r, date = kkbApiDateText_(r[2], tz), j = String(r[9] || '').trim();
    const k = [date, Number(r[4]), String(r[5]).trim()].join('|');
    const free = blanks[k] || [];
    const note = String(r[13] || '');
    const at = note.indexOf('分類：');
    return { importId: String(r[0]), date: date, merchant: String(r[3] || '').trim(), amount: Number(r[4]), method: String(r[5] || '').trim(),
      kubun: String(r[6] || '').trim(), himoku: String(r[7] || '').trim(), sat: String(r[8] || '').trim(), j: j, status: String(r[10]).trim(),
      reason: at >= 0 ? note.slice(at + 3) : '', looseRows: j ? [] : free.slice(0, 3), looseSure: !j && free.length === 1 && pendingCount[k] === 1 };
  });
  return { ok: true, items: items };
}

/**
 * 候補の処理：add=未記録として反映 / force=重複候補だが別取引として反映 / recorded=記録済みなので追加しない / exclude=対象外。
 * 処理済みの行は状態で判定するので、応答が届かず再送しても増えない。
 */
function kkbApiCsvApply_(ss, items) {
  const sheet = requireSheetV3_(ss, KKV3_CARD.IMPORT_SHEET);
  const raw = requireSheetV3_(ss, KKB_API.RAW_SHEET);
  const index = {};
  kkbApiCardRows_(sheet, 14).forEach((r, i) => { if (r[0]) index[String(r[0])] = { row: KKV3_CARD.FIRST_DATA_ROW + i, status: String(r[10]).trim(), note: String(r[13] || '') }; });
  const results = [], adds = [];
  items.forEach(it => {
    const t = index[it.importId];
    if (!t) { results.push({ importId: it.importId, status: 'error', error: 'not_found' }); return; }
    if (KKB_CSV.PENDING.indexOf(t.status) < 0) { results.push({ importId: it.importId, status: 'done', repeated: true }); return; }
    if (it.action === 'exclude') { sheet.getRange(t.row, 11).setValue('対象外'); results.push({ importId: it.importId, status: 'done' }); return; }
    if (it.action === 'recorded') {
      sheet.getRange(t.row, 11).setValue('重複除外');
      if (it.rawRow) sheet.getRange(t.row, 14).setValue(t.note + '／' + KKB_CSV.LINK_MARK + Number(it.rawRow));
      results.push({ importId: it.importId, status: 'done' });
      return;
    }
    if ((it.action !== 'add' && it.action !== 'force') || KKB_API.KUBUN.indexOf(it.kubun) < 0 || !it.himoku) { results.push({ importId: it.importId, status: 'error', error: 'invalid' }); return; }
    sheet.getRange(t.row, 7).setValue(it.kubun);
    adds.push({ it: it, t: t });
  });
  SpreadsheetApp.flush();

  const ready = [];
  adds.forEach(a => {
    const v = sheet.getRange(a.t.row, 1, 1, 43).getValues()[0];
    const candidates = v.slice(14, 43).map(x => String(x || '').trim());
    if (candidates.indexOf(a.it.himoku) < 0) { results.push({ importId: a.it.importId, status: 'error', error: 'invalid', message: '区分と費目の組合せ' }); return; }
    if (String(v[9] || '').trim() && a.it.action !== 'force') { results.push({ importId: a.it.importId, status: 'error', error: 'duplicate', message: String(v[9]) }); return; }
    if (!(v[2] instanceof Date) || !Number(v[4]) || !String(v[3]).trim() || !String(v[5]).trim()) { results.push({ importId: a.it.importId, status: 'error', error: 'invalid', message: '未完成の明細' }); return; }
    const sat = KKB_API.SATISFACTION.indexOf(a.it.sat) >= 0 ? a.it.sat : 'ー';
    sheet.getRange(a.t.row, 8).setValue(a.it.himoku);
    sheet.getRange(a.t.row, 9).setValue(sat);
    ready.push({ a: a, v: v, sat: sat });
  });

  // 01_Raw_Data の空き行に入れる（削除でできた途中の空行も使う）。上限行を超えては書かない。
  const blanks = [];
  raw.getRange(KKB_API.FIRST_ROW, 2, KKB_API.LAST_ROW - KKB_API.FIRST_ROW + 1, 1).getDisplayValues().forEach((r, i) => { if (!r[0]) blanks.push(KKB_API.FIRST_ROW + i); });
  const now = new Date();
  const placed = ready.slice(0, blanks.length).map((x, i) => Object.assign(x, { rawRow: blanks[i] }));
  ready.slice(blanks.length).forEach(x => results.push({ importId: x.a.it.importId, status: 'error', error: 'full' }));
  // コード.gs と同じ順：区分を含む列 → 候補の再計算 → 費目
  placed.forEach(x => {
    raw.getRange(x.rawRow, 2, 1, 3).setValues([[x.v[2], Number(x.v[4]), x.a.it.kubun]]);
    raw.getRange(x.rawRow, 6, 1, 4).setValues([[String(x.v[5]).trim(), String(x.v[3]).trim(), x.sat, 'カードCSV']]);
    raw.getRange(x.rawRow, 12).setValue(now);
  });
  if (placed.length) SpreadsheetApp.flush();
  placed.forEach(x => {
    raw.getRange(x.rawRow, 5).setValue(x.a.it.himoku);
    sheet.getRange(x.a.t.row, 11).setValue('取込済');
    if (x.a.it.action === 'force') sheet.getRange(x.a.t.row, 14).setValue(x.a.t.note + '／' + KKB_CSV.FORCE_MARK);
    results.push({ importId: x.a.it.importId, status: 'done' });
  });
  SpreadsheetApp.flush();
  return { ok: true, results: results };
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

// 設定変更を作る前に、数式・入力規則・保護の位置を確認するための読み取り専用の書き出し。
// シートには何も書かない。手入力の金額は「#」に置き換える。
function kkbApiInspectMaster() {
  const ss = SpreadsheetApp.getActive();
  const out = [];
  const dump = (name, maxRows, onlyLinks) => {
    const sh = ss.getSheetByName(name);
    if (!sh) { out.push('## ' + name + '：なし'); return; }
    const rows = Math.min(sh.getLastRow(), maxRows), cols = sh.getLastColumn();
    out.push('## ' + name + ' 行' + sh.getLastRow() + ' 列' + cols + ' 非表示:' + sh.isSheetHidden());
    const range = sh.getRange(1, 1, rows, cols), f = range.getFormulas(), v = range.getValues(), dv = range.getDataValidations();
    const rules = {};
    f.forEach((line, r) => {
      const cells = [];
      line.forEach((formula, c) => {
        const a1 = sh.getRange(r + 1, c + 1).getA1Notation();
        const rule = dv[r][c];
        if (rule) { const k = rule.getCriteriaType() + ' ' + JSON.stringify(rule.getCriteriaValues().map(x => (x && x.getA1Notation) ? x.getSheet().getName() + '!' + x.getA1Notation() : x)); (rules[k] = rules[k] || []).push(a1); }
        if (formula) { if (!onlyLinks || /費目管理|96_Drop_Down/.test(formula)) cells.push(a1 + '=' + formula); return; }
        if (onlyLinks || v[r][c] === '') return;
        cells.push(a1 + ':' + (typeof v[r][c] === 'number' ? '#' : v[r][c] instanceof Date ? '日付' : typeof v[r][c] === 'boolean' ? v[r][c] : v[r][c]));
      });
      if (cells.length) out.push(cells.join(' ¦ '));
    });
    Object.keys(rules).forEach(k => out.push('規則 ' + k + ' → ' + rules[k][0] + '…' + rules[k][rules[k].length - 1] + '（' + rules[k].length + 'セル）'));
    sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => out.push('保護 ' + p.getRange().getA1Notation()));
  };
  dump('費目管理', 150, false);
  dump('96_Drop_Down', 4, false);
  dump('11月', 60, true);
  const text = out.join(String.fromCharCode(10)).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput('<textarea style="width:100%;height:420px" readonly onclick="this.select()">' + text + '</textarea><p>クリックして全選択し、コピーしてください。</p>').setWidth(760).setHeight(520),
    '費目管理の構造（' + out.length + '行）');
}
