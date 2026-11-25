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
    .addItem('重さを診断する（読み取りのみ）', 'kkbApiInspectWeight')
    .addItem('月シートの数式を書き出す（読み取りのみ）', 'kkbApiInspectMonth')
    .addItem('月シートの予算の固定を解除', 'kkbApiUnfreezeAll')
    .addSeparator()
    .addItem('照合済みのカード明細を値に固定（軽くする）', 'kkbApiFreezeCardMatch')
    .addItem('カード明細の照合の固定を解除', 'kkbApiUnfreezeCardMatch')
    .addItem('月シートの集計を軽くする', 'kkbApiLightenMonths')
    .addItem('月シートの集計を元に戻す', 'kkbApiRestoreMonths')
    .addSeparator()
    .addItem('費目が空のまま残った取引行を消す', 'kkbApiClearIncompleteRows')
    .addItem('費目管理を正本にする（移行）', 'kkbApiMigrateMaster')
    .addItem('候補と入力規則を作り直す', 'kkbApiRebuildRules')
    .addItem('費目管理の連動を元に戻す', 'kkbApiRestoreMasterMenu')
    .addItem('候補と入力規則のつながりを書き出す（読み取りのみ）', 'kkbApiInspectLinks')
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
      if (req.action === 'settingsRead') return kkbApiJson_(kkbApiSettingsRead_(ss));
      if (req.action === 'settingsApply') return kkbApiJson_(Object.assign({ ok: true }, kkbApiSettingsApply_(ss, req.op || {})));
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
    frozen: kkbApiFrozenBudgets_(ss),
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
  const hidden = kkbApiHidden_();
  items.forEach(i => { i.hidden = hidden.items.indexOf(i.kubun + '|' + i.himoku) >= 0; });
  // 費目管理の各区分の枠にある費目だけ（収入の枠の下にある「固定費予算」などの集計欄を候補に混ぜない）
  const inBlock = {};
  KKB_MS.KUBUN.forEach(k => { for (let r = k.first; r <= k.last; r++) { const n = String(fmRows[r - 1] ? fmRows[r - 1][kkbApiColNum_(k.name) - 1] : '').trim(); if (n) inBlock[k.kubun + '|' + n] = true; } });
  return { items: items.filter(i => inBlock[i.kubun + '|' + i.himoku]), methods: methods.filter(m => hidden.methods.indexOf(m) < 0), hiddenMethods: hidden.methods };
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

    // 費目が費目管理（96_Drop_Down）にない組合せなら、1セルも書かずに断る
    if (!kkbApiHimokuKnown_(ss, tx.kubun, tx.himoku)) {
      results.push({ opId: op.opId, status: 'error', error: 'invalid', message: kkbApiNoCandidate_(tx) }); return;
    }

    const date = Utilities.parseDate(tx.date, tz, 'yyyy-MM-dd');   // 日付だけの値をシートの時差で解釈
    const g = kkbApiPlaceDetail_(tx.place, tx.detail);
    const sat = tx.sat && KKB_API.SATISFACTION.indexOf(tx.sat) >= 0 ? tx.sat : 'ー';
    let written, hash;
    // 途中で失敗したら、この行の B:I と L を空に戻して「受付不可」で返す。
    // リクエスト全体のエラーにすると、アプリが毎回再送して未完成の行が増えるため。
    try {
      // コード.gs（applyApprovedCardRows）と同じ順：区分を含む列 → 費目候補の再計算 → 費目
      raw.getRange(row, 2, 1, 3).setValues([[date, Number(tx.amount), tx.kubun]]);
      raw.getRange(row, 6, 1, 4).setValues([[tx.method, g, sat, '手入力']]);
      raw.getRange(row, 12).setValue(new Date());
      kkbApiSetHimokuRules_(raw, row, 1, 4, 5);   // 区分に合わせて費目の候補を付け替える（移行後）
      SpreadsheetApp.flush();
      if (!kkbApiRowAllows_(raw, row, tx.himoku)) throw new Error(kkbApiNoCandidate_(tx));
      raw.getRange(row, 5).setValue(tx.himoku);
      SpreadsheetApp.flush();
      written = kkbApiNormalizeRow_(raw.getRange(row, 2, 1, 8).getValues()[0], tz);
      if (!written || written.himoku !== String(tx.himoku).trim()) throw new Error('費目を書き込めませんでした');
      hash = kkbApiRowHash_(written);
      ledger.appendRow([op.opId, tx.id, 'add', row, hash, new Date(), device.name]);
    } catch (err) {
      kkbApiClearRow_(raw, row);
      results.push({ opId: op.opId, status: 'error', error: 'invalid', message: kkbApiErrText_(err) });
      return;
    }
    done[op.opId] = { opId: op.opId, txId: tx.id, row: row };
    // 書き込んだ行をそのまま返す。アプリはこれを手元の明細に足し、明細の読み直しを省く
    results.push({ opId: op.opId, status: 'done', txId: tx.id, row: row, sheetRow: written ? Object.assign(written, { id: tx.id, hash: hash, row: row }) : null });
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
  let hash = '', written = null;
  const tx = op.tx || {};
  if (op.type !== 'delete') {
    const problem = kkbApiValidate_(tx);
    if (problem) return { opId: op.opId, status: 'error', error: 'invalid', message: problem };
  }
  // 失敗したら空にせず元の値に戻す（すでにある本物の取引を消さないため）
  const before = kkbApiSaveRow_(raw, row);
  try {
    if (op.type === 'delete') {
      raw.getRange(row, 2, 1, 8).clearContent();
      raw.getRange(row, 12).clearContent();
      SpreadsheetApp.flush();
    } else {
      const sat = tx.sat && KKB_API.SATISFACTION.indexOf(tx.sat) >= 0 ? tx.sat : 'ー';
      const old = before.values[0];
      // 区分・費目が変わらないなら E 列は書かない（候補から外した費目の過去行も直せるように）
      const himokuChanged = String(old[2]).trim() !== tx.kubun || String(old[3]).trim() !== String(tx.himoku).trim();
      if (himokuChanged && !kkbApiHimokuKnown_(raw.getParent(), tx.kubun, tx.himoku)) throw new Error(kkbApiNoCandidate_(tx));
      // 追加と同じ順：区分 → 費目候補の再計算 → 費目。データ元（I列）と登録日時（L列）は変えない。
      raw.getRange(row, 2, 1, 3).setValues([[Utilities.parseDate(tx.date, tz, 'yyyy-MM-dd'), Number(tx.amount), tx.kubun]]);
      raw.getRange(row, 6, 1, 3).setValues([[tx.method, kkbApiPlaceDetail_(tx.place, tx.detail), sat]]);
      SpreadsheetApp.flush();
      if (himokuChanged) {
        if (String(old[2]).trim() !== tx.kubun && kkbApiSetHimokuRules_(raw, row, 1, 4, 5)) SpreadsheetApp.flush();
        if (!kkbApiRowAllows_(raw, row, tx.himoku)) throw new Error(kkbApiNoCandidate_(tx));
        raw.getRange(row, 5).setValue(tx.himoku);
        SpreadsheetApp.flush();
      }
      written = kkbApiNormalizeRow_(raw.getRange(row, 2, 1, 8).getValues()[0], tz);
      if (!written || written.himoku !== String(tx.himoku).trim()) throw new Error('費目を書き込めませんでした');
      hash = kkbApiRowHash_(written);
    }
    ledger.appendRow([op.opId, target.id || '', op.type, row, hash, new Date(), device.name]);
  } catch (err) {
    kkbApiRestoreRow_(raw, row, before);
    return { opId: op.opId, status: 'error', error: 'invalid', message: kkbApiErrText_(err) };
  }
  // 修正後の行（削除なら deleted）を返す。アプリはこれで手元の明細を直し、読み直しを省く
  return { opId: op.opId, status: 'done', txId: target.id, row: row,
    sheetRow: written ? Object.assign(written, { id: target.id, hash: hash, row: row }) : null, deleted: op.type === 'delete' };
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
    kkbApiSetHimokuRules_(sheet, t.row, 1, 7, 8);
    adds.push({ it: it, t: t });
  });
  SpreadsheetApp.flush();

  const ready = [];
  adds.forEach(a => {
    const v = sheet.getRange(a.t.row, 1, 1, 43).getValues()[0];
    const candidates = kkbApiMasterOn_() ? kkbApiCandidates_(ss, a.it.kubun) : v.slice(14, 43).map(x => String(x || '').trim());
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
  // コード.gs と同じ順：区分を含む列 → 候補の再計算 → 費目。
  // 1行でも途中で失敗したら、その行の B:I と L を空に戻し、明細は取込前の状態（要確認など）のまま残す。
  const fail = (x, err) => {
    kkbApiClearRow_(raw, x.rawRow);
    x.failed = true;
    results.push({ importId: x.a.it.importId, status: 'error', error: 'invalid', message: kkbApiErrText_(err) });
  };
  placed.forEach(x => {
    try {
      raw.getRange(x.rawRow, 2, 1, 3).setValues([[x.v[2], Number(x.v[4]), x.a.it.kubun]]);
      raw.getRange(x.rawRow, 6, 1, 4).setValues([[String(x.v[5]).trim(), String(x.v[3]).trim(), x.sat, 'カードCSV']]);
      raw.getRange(x.rawRow, 12).setValue(now);
      kkbApiSetHimokuRules_(raw, x.rawRow, 1, 4, 5);
    } catch (err) { fail(x, err); }
  });
  if (placed.length) SpreadsheetApp.flush();
  placed.filter(x => !x.failed).forEach(x => {
    try {
      if (!kkbApiRowAllows_(raw, x.rawRow, x.a.it.himoku)) throw new Error(kkbApiNoCandidate_(x.a.it));
      raw.getRange(x.rawRow, 5).setValue(x.a.it.himoku);
    } catch (err) { fail(x, err); }
  });
  if (placed.length) SpreadsheetApp.flush();
  placed.filter(x => !x.failed).forEach(x => {
    if (String(raw.getRange(x.rawRow, 5).getValue()).trim() !== String(x.a.it.himoku).trim()) { fail(x, new Error('費目を書き込めませんでした')); return; }
    sheet.getRange(x.a.t.row, 11).setValue('取込済');
    if (x.a.it.action === 'force') sheet.getRange(x.a.t.row, 14).setValue(x.a.t.note + '／' + KKB_CSV.FORCE_MARK);
    results.push({ importId: x.a.it.importId, status: 'done' });
  });
  SpreadsheetApp.flush();
  // 照合を値に固定している場合は、取込済になった行も続けて固定する
  if (PropertiesService.getScriptProperties().getProperty(KKB_CARDJ.FORMULA)) kkbApiCardFreeze_(ss);
  return { ok: true, results: results };
}

// ---------- 書込の失敗に備える ----------

// 費目管理から作られる 96_Drop_Down の一覧（G:H）に、この区分・費目の組合せがあるか
function kkbApiHimokuKnown_(ss, kubun, himoku) {
  const list = kkbApiCandidates_(ss, kubun);
  return !list.length || list.indexOf(String(himoku).trim()) >= 0;   // 一覧が読めないときは、書込後の入力規則の確認に任せる
}

// その行の費目セル（E列）の入力規則が、この費目を受け付けるか。規則がなければ受け付ける
function kkbApiRowAllows_(raw, row, himoku) {
  const rule = raw.getRange(row, 5).getDataValidation();
  if (!rule) return true;
  const type = rule.getCriteriaType(), args = rule.getCriteriaValues(), want = String(himoku).trim();
  if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
    const vals = args[0].getValues();
    // 一覧がまだ計算中で空に見えるときは、ここでは断らない（書込時の入力規則と書込後の確認に任せる）
    if (!vals.some(line => line.some(v => String(v).trim()))) return true;
    return vals.some(line => line.some(v => String(v).trim() === want));
  }
  if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return (args[0] || []).some(v => String(v).trim() === want);
  return true;
}

const kkbApiNoCandidate_ = tx => '費目「' + tx.himoku + '」が区分「' + tx.kubun + '」の候補にありません';
const kkbApiErrText_ = err => String(err && err.message || err).slice(0, 200);

// 追加に失敗した行を空に戻す（行は消さない。数式の範囲がずれるため）
function kkbApiClearRow_(raw, row) {
  try {
    raw.getRange(row, 2, 1, 8).clearContent();
    raw.getRange(row, 12).clearContent();
    SpreadsheetApp.flush();
  } catch (e) { console.error('空に戻せませんでした：行' + row + ' ' + e); }
}

// 修正前の B:I と L を控える（数式のセルは数式で控える）
function kkbApiSaveRow_(raw, row) {
  const a = raw.getRange(row, 2, 1, 8), l = raw.getRange(row, 12);
  return { values: a.getValues(), formulas: a.getFormulas(), l: l.getValue(), lf: l.getFormula() };
}

// 書く順は追加と同じ：区分を含む列 → 候補の再計算 → 費目（同時に書くと、古い候補で費目が断られることがある）
function kkbApiRestoreRow_(raw, row, s) {
  const cell = (c) => s.formulas[0][c] || s.values[0][c];
  try {
    raw.getRange(row, 2, 1, 3).setValues([[cell(0), cell(1), cell(2)]]);
    raw.getRange(row, 6, 1, 4).setValues([[cell(4), cell(5), cell(6), cell(7)]]);
    raw.getRange(row, 12).setValue(s.lf || s.l);
    kkbApiSetHimokuRules_(raw, row, 1, 4, 5);
    SpreadsheetApp.flush();
    const e = raw.getRange(row, 5);
    if (String(e.getValue()) !== String(s.values[0][3])) { e.setValue(cell(3)); SpreadsheetApp.flush(); }
  } catch (err) { console.error('元に戻せませんでした：行' + row + ' ' + err); }
}

// メニュー：費目が空のまま残った取引行（日付・金額はあるのに E が空）を探し、確認してから値だけ消す
function kkbApiClearIncompleteRows() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const raw = requireSheetV3_(ss, KKB_API.RAW_SHEET);
  const tz = ss.getSpreadsheetTimeZone();
  const last = Math.min(raw.getLastRow(), KKB_API.LAST_ROW);
  if (last < KKB_API.FIRST_ROW) { ui.alert('対象の行はありません'); return; }
  const n = last - KKB_API.FIRST_ROW + 1;
  const v = raw.getRange(KKB_API.FIRST_ROW, 2, n, 11).getValues();   // B:L
  const rows = [];
  v.forEach((r, i) => {
    if (r[0] !== '' && r[1] !== '' && String(r[3]).trim() === '' && r[10] !== '') rows.push({ row: KKB_API.FIRST_ROW + i, r: r });
  });
  if (!rows.length) { ui.alert('費目が空の取引行はありません'); return; }
  const fmt = d => d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy/MM/dd HH:mm') : String(d);
  const lines = rows.slice(0, 40).map(x => '行' + x.row + '：' + fmt(x.r[0]).slice(0, 10) + '・' + x.r[1] + '・' + x.r[2] + '・' + x.r[7] + '（登録 ' + fmt(x.r[10]) + '）');
  if (rows.length > 40) lines.push('…ほか' + (rows.length - 40) + '行');
  if (ui.alert('費目が空の取引行 ' + rows.length + '行（行' + rows[0].row + '〜' + rows[rows.length - 1].row + '）',
    lines.join('\n') + '\n\nこれらの行の B:I と L の値だけを消します（行は削除しません）。よろしいですか？',
    ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  rows.forEach(x => { raw.getRange(x.row, 2, 1, 8).clearContent(); raw.getRange(x.row, 12).clearContent(); });
  SpreadsheetApp.flush();
  ui.alert(rows.length + '行の値を消しました');
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

// 3シート（01_Raw_Data・固定コピペ用・03_Card_Import）と 96_Drop_Down の、見出し・数式・入力規則を書き出す（読み取りのみ）
function kkbApiInspectLinks() {
  const ss = SpreadsheetApp.getActive();
  const out = [];
  const dump = (name, r1, r2, head) => {
    const sh = ss.getSheetByName(name);
    if (!sh) { out.push('## ' + name + '：なし'); return; }
    const cols = sh.getLastColumn();
    r2 = Math.min(r2, sh.getLastRow());
    out.push('## ' + name + ' 行' + r1 + '〜' + r2 + '（最終行' + sh.getLastRow() + ' 列' + cols + '）');
    if (r2 < r1) return;
    const range = sh.getRange(r1, 1, r2 - r1 + 1, cols), f = range.getFormulas(), v = range.getDisplayValues(), dv = range.getDataValidations();
    f.forEach((line, r) => {
      const cells = [];
      line.forEach((formula, c) => {
        const a1 = sh.getRange(r1 + r, c + 1).getA1Notation(), rule = dv[r][c];
        if (rule) cells.push(a1 + '［規則 ' + rule.getCriteriaType() + ' ' + JSON.stringify(rule.getCriteriaValues().map(x => (x && x.getA1Notation) ? x.getSheet().getName() + '!' + x.getA1Notation() : (Array.isArray(x) ? x.length + '件' : x))) + (rule.getAllowInvalid() ? ' 警告のみ' : ' 拒否') + '］');
        if (formula) cells.push(a1 + '=' + formula.slice(0, 300));
        else if (v[r][c] !== '' && r1 + r <= head) cells.push(a1 + ':' + v[r][c].slice(0, 30));   // 値は見出し行だけ（取引の中身は出さない）
      });
      if (cells.length) out.push(cells.join(' ¦ '));
    });
  };
  dump('96_Drop_Down', 1, 3, 3);
  dump('01_Raw_Data', 1, 6, 4);
  dump('固定コピペ用', 1, 4, 2);
  dump('03_Card_Import', 1, 5, 3);
  const text = out.join(String.fromCharCode(10)).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput('<textarea style="width:100%;height:420px" readonly onclick="this.select()">' + text + '</textarea><p>クリックして全選択し、コピーしてください。</p>').setWidth(760).setHeight(520),
    '候補と入力規則のつながり（' + out.length + '行）');
}

// ---- 設定変更（費目管理） ----
// 手入力の値だけを書き換える。数式のセルには書き込まない。
const KKB_BLOCKS = {
  '収入': { first: 3, last: 14, col: 1 },
  '先取り貯金・投資': { first: 3, last: 27, col: 9 },
  '支出（固定費）': { first: 33, last: 62, col: 1 },
  '支出（変動費）': { first: 33, last: 62, col: 9 },
  '支出（特別費）': { first: 68, last: 92, col: 1 },
};
const KKB_OFFSET = { name: 0, note: 1, method: 2, group: 3, order: 4, budget: 6 };
const KKB_METHOD = { col: 17, first: 3, last: 62 };
const KKB_WEEK_COL = 16;
const KKB_VAR = '支出（変動費）';

function kkbApiHidden_() {
  if (kkbApiMasterOn_()) return kkbApiHiddenFromSheet_(SpreadsheetApp.getActive());
  try { return Object.assign({ items: [], methods: [] }, JSON.parse(PropertiesService.getScriptProperties().getProperty('KKB_HIDDEN') || '{}')); }
  catch (e) { return { items: [], methods: [] }; }
}

function kkbApiSettingsRead_(ss) {
  const sh = requireSheetV3_(ss, '費目管理');
  const hidden = kkbApiHidden_();
  const items = [];
  Object.keys(KKB_BLOCKS).forEach(kubun => {
    const b = KKB_BLOCKS[kubun];
    sh.getRange(b.first, b.col, b.last - b.first + 1, 8).getValues().forEach((v, i) => {
      const himoku = String(v[0] || '').trim();
      if (!himoku) return;
      const row = b.first + i;
      items.push({ kubun: kubun, row: row, himoku: himoku, group: String(v[KKB_OFFSET.group] || '').trim(), order: Number(v[KKB_OFFSET.order]) || 0,
        budget: Number(v[KKB_OFFSET.budget]) || 0, weekly: kubun === KKB_VAR && sh.getRange(row, KKB_WEEK_COL).getValue() === true,
        hidden: hidden.items.indexOf(kubun + '|' + himoku) >= 0 });
    });
  });
  const methods = [];
  sh.getRange(KKB_METHOD.first, KKB_METHOD.col, KKB_METHOD.last - KKB_METHOD.first + 1, 1).getValues().forEach(v => {
    const name = String(v[0] || '').trim();
    if (name && !methods.some(m => m.name === name)) methods.push({ name: name, hidden: hidden.methods.indexOf(name) >= 0 });
  });
  return { ok: true, items: items, methods: methods };
}

function kkbApiSameCell_(a, b) {
  if (typeof a === 'number' || typeof b === 'number') return (Number(a) || 0) === (Number(b) || 0);
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  return String(a === undefined || a === null ? '' : a).trim() === String(b === undefined || b === null ? '' : b).trim();
}

// 1件の項目を書く。すでに希望の値なら何もしない。取得後に変わっていれば上書きしない。
function kkbApiSetCell_(sh, row, col, from, to) {
  const cell = sh.getRange(row, col);
  if (cell.getFormula()) return { status: 'error', message: 'このセルは数式のため変更できません' };
  const cur = cell.getValue();
  if (kkbApiSameCell_(cur, to)) return { status: 'done', repeated: true };
  if (!kkbApiSameCell_(cur, from)) return { status: 'conflict' };
  cell.setValue(to);
  return { status: 'done' };
}

function kkbApiSettingsApply_(ss, op) {
  const sh = requireSheetV3_(ss, '費目管理');
  if (op.type === 'hide') return kkbApiMasterOn_() ? kkbApiSetHiddenSheet_(ss, op) : kkbApiSetHidden_(op);
  const b = KKB_BLOCKS[op.kubun];
  if (!b) return { status: 'error', message: '区分が正しくありません' };
  const row = Number(op.row);
  if (!(row >= b.first && row <= b.last) || String(sh.getRange(row, b.col).getValue()).trim() !== op.himoku)
    return { status: 'conflict', message: '費目の位置が変わっています。読み直したので、確認してもう一度保存してください' };
  if (op.type === 'order') return kkbApiSetCell_(sh, row, b.col + KKB_OFFSET.order, Number(op.from), Number(op.to));
  if (op.type === 'weekly') {
    if (op.kubun !== KKB_VAR) return { status: 'error', message: '週管理は変動費だけです' };
    return kkbApiSetCell_(sh, row, KKB_WEEK_COL, !!op.from, !!op.to);
  }
  if (op.type === 'budget') {
    const col = b.col + KKB_OFFSET.budget;
    if (op.kubun !== KKB_VAR) return kkbApiSetCell_(sh, row, col, Number(op.from), Number(op.to));
    return kkbApiKeepPast_(ss, () => kkbApiSetCell_(sh, row, col, Number(op.from), Number(op.to)));
  }
  return { status: 'error', message: '未対応の操作です' };
}

function kkbApiSetHidden_(op) {
  const h = kkbApiHidden_(), list = op.target === 'method' ? h.methods : h.items, at = list.indexOf(op.key);
  if (op.to && at < 0) list.push(op.key);
  if (!op.to && at >= 0) list.splice(at, 1);
  PropertiesService.getScriptProperties().setProperty('KKB_HIDDEN', JSON.stringify(h));
  return { status: 'done' };
}

// ---------- 費目管理を正本にする（候補と入力規則の連動） ----------
//
// 費目管理 → 96_Drop_Down（数式で候補一覧を作る。件数の上限なし）→ 3シートの入力規則（区分ごとの一覧を直接参照）。
//   ・費目・入出金方法の追加／削除／区分の移動／隠す は、費目管理を書き換えるだけで数式が一覧を作り直す
//   ・取引行の区分が変わったときだけ、その行の費目の入力規則を付け替える（手入力は onEdit、アプリ・CSV はスクリプト）
//   ・過去の行の値は変えない（候補から外れた費目は赤い印が出るだけ）
// 移行はメニュー「費目管理を正本にする（移行）」で1回だけ。前後で集計の値を全セル比べ、違えば自動で元に戻す。
const KKB_MS = Object.freeze({
  FLAG: 'KKB_MASTER_V2',          // 移行済みなら 'on'
  BACKUP: 'KKB_MASTER_V2_BACKUP', // 移行前の数式と隠す設定
  DD: '96_Drop_Down',
  LIST_ROWS: 199,                 // 一覧は 2〜200 行目（費目管理の各区分の枠より十分大きい）
  // 区分ごとの「候補に出す費目」：96_Drop_Down の列と、費目管理の枠・隠す欄
  KUBUN: [
    { kubun: '収入', col: 'Q', name: 'A', hide: 'H', first: 3, last: 14 },
    { kubun: '先取り貯金・投資', col: 'R', name: 'I', hide: 'S', first: 3, last: 27 },
    { kubun: '支出（固定費）', col: 'S', name: 'A', hide: 'H', first: 33, last: 62 },
    { kubun: '支出（変動費）', col: 'T', name: 'I', hide: 'S', first: 33, last: 62 },
    { kubun: '支出（特別費）', col: 'U', name: 'A', hide: 'H', first: 68, last: 92 },
  ],
  ALL_COL: 'V',                   // 区分が空の行に出す、すべての費目
  METHOD_COL: 'W',                // 候補に出す入出金方法
  METHOD_HIDE: 'R',               // 費目管理：入出金方法（Q列）の隠す欄
  HIDE_HEADER: '候補に出さない',
  // 取引を入れる3シート：区分・費目・入出金方法の列と、入力規則を付ける行の範囲
  SHEETS: [
    { name: '01_Raw_Data', kubun: 4, himoku: 5, method: 6, first: 5, last: 4986, helpers: ['N5', 'AF5'] },
    { name: '固定コピペ用', kubun: 3, himoku: 4, method: 5, first: 2, last: 1027, helpers: ['I2', 'J2'] },
    { name: '03_Card_Import', kubun: 7, himoku: 8, method: 6, first: 5, last: 4011, helpers: ['O5'] },
  ],
});

const kkbApiMasterOn_ = () => PropertiesService.getScriptProperties().getProperty(KKB_MS.FLAG) === 'on';
const kkbApiColNum_ = letter => letter.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

function kkbApiListFormula_(k) {
  const fm = "'費目管理'!";
  const name = fm + k.name + k.first + ':' + k.name + k.last, hide = fm + k.hide + k.first + ':' + k.hide + k.last;
  return '=IFERROR(UNIQUE(FILTER(' + name + ',' + name + '<>"",' + hide + '<>TRUE)),"")';
}

// 96_Drop_Down に書く見出しと数式（Q1:W2）
function kkbApiListCells_() {
  const all = KKB_MS.KUBUN[0].col + '2:' + KKB_MS.KUBUN[KKB_MS.KUBUN.length - 1].col + (KKB_MS.LIST_ROWS + 1);
  const cells = KKB_MS.KUBUN.map(k => ({ col: k.col, head: k.kubun, formula: kkbApiListFormula_(k) }));
  cells.push({ col: KKB_MS.ALL_COL, head: 'すべての費目', formula: '=IFERROR(UNIQUE(FILTER(TOCOL(' + all + '),TOCOL(' + all + ')<>"")),"")' });
  cells.push({ col: KKB_MS.METHOD_COL, head: '入出金方法', formula: "=IFERROR(UNIQUE(FILTER('費目管理'!Q3:Q62,'費目管理'!Q3:Q62<>\"\",'費目管理'!" + KKB_MS.METHOD_HIDE + '3:' + KKB_MS.METHOD_HIDE + '62<>TRUE)),"")' });
  return cells;
}

function kkbApiListRange_(ss, col) {
  return ss.getSheetByName(KKB_MS.DD).getRange(col + '2:' + col + (KKB_MS.LIST_ROWS + 1));
}

// 区分に出す費目（移行前は 96_Drop_Down G:H の一覧）
function kkbApiCandidates_(ss, kubun) {
  ss = ss || SpreadsheetApp.getActive();
  kubun = String(kubun || '').trim();
  if (kkbApiMasterOn_()) {
    const k = KKB_MS.KUBUN.filter(x => x.kubun === kubun)[0];
    if (!k) return [];
    return kkbApiListRange_(ss, k.col).getValues().map(r => String(r[0]).trim()).filter(Boolean);
  }
  const dd = ss.getSheetByName(KKB_MS.DD);
  if (!dd || dd.getLastRow() < 2) return [];
  return dd.getRange(2, 7, dd.getLastRow() - 1, 2).getValues().filter(r => String(r[0]).trim() === kubun).map(r => String(r[1]).trim()).filter(Boolean);
}

// 区分 → 費目の入力規則（拒否）。区分が空・不明なら、すべての費目
function kkbApiRuleCache_(ss) {
  const cache = {};
  const make = col => SpreadsheetApp.newDataValidation().requireValueInRange(kkbApiListRange_(ss, col), true).setAllowInvalid(false).build();
  return kubun => {
    const k = KKB_MS.KUBUN.filter(x => x.kubun === String(kubun || '').trim())[0];
    const col = k ? k.col : KKB_MS.ALL_COL;
    return cache[col] = cache[col] || make(col);
  };
}

// 指定した行の費目セルに、その行の区分の入力規則を付ける（移行前は何もしない）
function kkbApiSetHimokuRules_(sheet, firstRow, count, kubunCol, himokuCol) {
  if (!kkbApiMasterOn_() || count < 1) return false;
  const rule = kkbApiRuleCache_(sheet.getParent());
  const kubun = sheet.getRange(firstRow, kubunCol, count, 1).getValues();
  sheet.getRange(firstRow, himokuCol, count, 1).setDataValidations(kubun.map(r => [rule(r[0])]));
  return true;
}

// 3シートすべての費目・入出金方法の入力規則を付け直す（メニュー「候補と入力規則を作り直す」と移行で使う）
function kkbApiApplyRules_(ss) {
  const methodRule = SpreadsheetApp.newDataValidation().requireValueInRange(kkbApiListRange_(ss, KKB_MS.METHOD_COL), true).setAllowInvalid(false).build();
  const rule = kkbApiRuleCache_(ss);
  KKB_MS.SHEETS.forEach(t => {
    const sh = ss.getSheetByName(t.name);
    if (!sh) return;
    const n = t.last - t.first + 1;
    const kubun = sh.getRange(t.first, t.kubun, n, 1).getValues();
    sh.getRange(t.first, t.himoku, n, 1).setDataValidations(kubun.map(r => [rule(r[0])]));
    sh.getRange(t.first, t.method, n, 1).setDataValidation(methodRule);
  });
}

function kkbApiRebuildRules() {
  const ui = SpreadsheetApp.getUi();
  if (!kkbApiMasterOn_()) { ui.alert('まだ移行していません。メニュー「費目管理を正本にする（移行）」を先に実行してください'); return; }
  kkbApiApplyRules_(SpreadsheetApp.getActive());
  ui.alert('候補と入力規則を作り直しました');
}

// シート上で区分を書き換えた・貼り付けたら、その行の費目の候補を付け替える
function onEdit(e) {
  try {
    if (!e || !e.range || !kkbApiMasterOn_()) return;
    const sh = e.range.getSheet(), t = KKB_MS.SHEETS.filter(x => x.name === sh.getName())[0];
    if (!t) return;
    const c1 = e.range.getColumn(), c2 = c1 + e.range.getNumColumns() - 1;
    if (t.kubun < c1 || t.kubun > c2) return;
    const r1 = Math.max(e.range.getRow(), t.first), r2 = Math.min(e.range.getRow() + e.range.getNumRows() - 1, t.last);
    if (r2 >= r1) kkbApiSetHimokuRules_(sh, r1, r2 - r1 + 1, t.kubun, t.himoku);
  } catch (err) { console.error('onEdit: ' + err); }
}

// 費目管理の「候補に出さない」欄から、隠している費目・方法を読む
function kkbApiHiddenFromSheet_(ss) {
  const fm = requireSheetV3_(ss, '費目管理');
  const v = fm.getRange(1, 1, 92, kkbApiColNum_('S')).getValues();
  const on = x => x === true || String(x).toUpperCase() === 'TRUE';
  const items = [], methods = [];
  KKB_MS.KUBUN.forEach(k => {
    for (let r = k.first; r <= k.last; r++) {
      const name = String(v[r - 1][kkbApiColNum_(k.name) - 1] || '').trim();
      if (name && on(v[r - 1][kkbApiColNum_(k.hide) - 1])) items.push(k.kubun + '|' + name);
    }
  });
  for (let r = 3; r <= 62; r++) {
    const name = String(v[r - 1][16] || '').trim();
    if (name && on(v[r - 1][kkbApiColNum_(KKB_MS.METHOD_HIDE) - 1]) && methods.indexOf(name) < 0) methods.push(name);
  }
  return { items: items, methods: methods };
}

// 隠す・戻す（費目管理のチェック欄を書く。取得時の状態と違えば上書きしない）
function kkbApiSetHiddenSheet_(ss, op) {
  const fm = requireSheetV3_(ss, '費目管理');
  const to = !!op.to, check = op.from === undefined ? null : !!op.from;
  const setFlag = (row, col) => {
    const cell = fm.getRange(row, col), cur = cell.getValue() === true;
    if (cur === to) return 'same';
    if (check !== null && cur !== check) return 'conflict';
    cell.setValue(to);
    return 'done';
  };
  if (op.target === 'method') {
    const name = String(op.key || '').trim(), rows = [];
    fm.getRange(3, 17, 60, 1).getValues().forEach((r, i) => { if (String(r[0]).trim() === name) rows.push(3 + i); });
    if (!rows.length) return { status: 'conflict', message: '入出金方法が見つかりません。読み直したので、確認してもう一度保存してください' };
    const res = rows.map(r => setFlag(r, kkbApiColNum_(KKB_MS.METHOD_HIDE)));
    if (res.indexOf('conflict') >= 0) return { status: 'conflict' };
    return res.indexOf('done') >= 0 ? { status: 'done' } : { status: 'done', repeated: true };
  }
  const parts = String(op.key || (op.kubun + '|' + op.himoku)).split('|');
  const k = KKB_MS.KUBUN.filter(x => x.kubun === parts[0])[0];
  if (!k) return { status: 'error', message: '区分が正しくありません' };
  const nameAt = r => String(fm.getRange(r, kkbApiColNum_(k.name)).getValue()).trim();
  let row = Number(op.row);
  if (!(row >= k.first && row <= k.last) || nameAt(row) !== parts[1]) {
    row = 0;
    for (let r = k.first; r <= k.last; r++) if (nameAt(r) === parts[1]) { row = r; break; }
  }
  if (!row) return { status: 'conflict', message: '費目の位置が変わっています。読み直したので、確認してもう一度保存してください' };
  const res = setFlag(row, kkbApiColNum_(k.hide));
  return res === 'conflict' ? { status: 'conflict' } : { status: 'done', repeated: res === 'same' };
}

// 移行前後で変わってはいけない値（集計・取引・取込・固定コピペ・既存の一覧）を控える
function kkbApiMasterSnapshot_(ss) {
  const snap = kkbApiLiteSnapshot_(ss);
  // 行数はシートの「最終行」ではなく決まった行数で読む（候補の列の数式を外すと最終行が縮むため）
  const take = (name, rows, cols) => {
    const s = ss.getSheetByName(name);
    if (!s) return;
    cols.forEach(c => { const a = kkbApiColNum_(c[0]), b = kkbApiColNum_(c[1]); snap[name + '!' + c[0]] = s.getRange(1, a, rows, b - a + 1).getValues(); });
  };
  KKB_MS.SHEETS.forEach(t => take(t.name, t.last, t.name === '01_Raw_Data' ? [['A', 'M'], ['AE', 'AE']] : t.name === '03_Card_Import' ? [['A', 'N']] : [['A', 'H']]));
  take('96_Drop_Down', 200, [['A', 'O']]);
  return snap;
}

function kkbApiMasterFlagCells_() {
  const cells = KKB_MS.KUBUN.map(k => ({ a1: k.hide + k.first + ':' + k.hide + k.last, head: k.hide + (k.first - 1) }));
  cells.push({ a1: KKB_MS.METHOD_HIDE + '3:' + KKB_MS.METHOD_HIDE + '62', head: KKB_MS.METHOD_HIDE + '2' });
  return cells;
}

function kkbApiMigrateMaster() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  if (kkbApiMasterOn_()) { ui.alert('移行済みです'); return; }
  if (ui.alert('費目管理を正本にする（移行）',
    '3シートの費目・入出金方法の候補を、費目管理から作る一覧に切り替えます。\n' +
    '・96_Drop_Down の Q:W 列に一覧の数式を追加\n・費目管理の H・R・S 列に「' + KKB_MS.HIDE_HEADER + '」のチェック欄を追加\n' +
    '・3シートの費目候補の列（01_Raw_Data N:AP、固定コピペ用 I:Z、03_Card_Import O:AQ）の数式を外す\n\n' +
    '前後で集計の値を全セル比べ、1つでも違えば自動で元に戻します。数分かかります。よろしいですか？', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) { ui.alert('ほかの処理中です。少し待ってからもう一度実行してください'); return; }
  try {
    const dd = requireSheetV3_(ss, KKB_MS.DD), fm = requireSheetV3_(ss, '費目管理');
    // 書く場所が空いているかを先に確かめる（何か入っていれば何もしない）
    const busy = [];
    kkbApiListCells_().forEach(c => { if (dd.getRange(c.col + '1:' + c.col + (KKB_MS.LIST_ROWS + 1)).getValues().some(r => r[0] !== '')) busy.push('96_Drop_Down!' + c.col); });
    const flagCells = kkbApiMasterFlagCells_();
    flagCells.forEach(f => {
      if (fm.getRange(f.a1).getValues().some(r => r[0] !== '' && r[0] !== false)) busy.push('費目管理!' + f.a1);
      if (fm.getRange(f.head).getValue() !== '') busy.push('費目管理!' + f.head);
    });
    if (busy.length) { ui.alert('使う予定の場所に値があるため中止しました', busy.join('\n'), ui.ButtonSet.OK); return; }

    const backup = {};
    KKB_MS.SHEETS.forEach(t => { const s = ss.getSheetByName(t.name); if (s) t.helpers.forEach(a1 => { backup[t.name + '!' + a1] = s.getRange(a1).getFormula(); }); });
    const hiddenBefore = kkbApiHidden_();
    props.setProperty(KKB_MS.BACKUP, JSON.stringify({ formulas: backup, hidden: hiddenBefore }));

    const before = kkbApiMasterSnapshot_(ss);
    // 1. 一覧の数式
    kkbApiListCells_().forEach(c => { dd.getRange(c.col + '1').setValue(c.head); dd.getRange(c.col + '2').setFormula(c.formula); });
    // 2. 隠す欄（今アプリで隠している費目・方法を引き継ぐ）
    const box = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    flagCells.forEach(f => { fm.getRange(f.head).setValue(KKB_MS.HIDE_HEADER); fm.getRange(f.a1).setDataValidation(box).setValue(false); });
    KKB_MS.KUBUN.forEach(k => {
      for (let r = k.first; r <= k.last; r++) {
        const name = String(fm.getRange(r, kkbApiColNum_(k.name)).getValue()).trim();
        if (name && hiddenBefore.items.indexOf(k.kubun + '|' + name) >= 0) fm.getRange(r, kkbApiColNum_(k.hide)).setValue(true);
      }
    });
    fm.getRange(3, 17, 60, 1).getValues().forEach((r, i) => { if (hiddenBefore.methods.indexOf(String(r[0]).trim()) >= 0) fm.getRange(3 + i, kkbApiColNum_(KKB_MS.METHOD_HIDE)).setValue(true); });
    SpreadsheetApp.flush();
    // 3. 入力規則を一覧に向け、費目候補の列の数式を外す
    props.setProperty(KKB_MS.FLAG, 'on');
    kkbApiApplyRules_(ss);
    KKB_MS.SHEETS.forEach(t => { const s = ss.getSheetByName(t.name); if (s) t.helpers.forEach(a1 => { if (backup[t.name + '!' + a1]) s.getRange(a1).clearContent(); }); });
    SpreadsheetApp.flush();

    // 4. 確かめる：集計などが1セルも変わっていないこと、一覧が空でないこと
    const diff = kkbApiLiteDiff_(before, kkbApiMasterSnapshot_(ss));
    const empty = kkbApiWaitLists_(ss);
    if (diff.length || empty.length) {
      kkbApiRestoreMaster_(ss);
      ui.alert('値が変わったため元に戻しました', (diff.length ? '変わったセル：' + diff.join('、') : '') + (empty.length ? '\n候補が空の区分：' + empty.join('、') : ''), ui.ButtonSet.OK);
      return;
    }
    ui.alert('移行しました', '費目管理の変更が、アプリ・01_Raw_Data・固定コピペ用・03_Card_Import の候補にそのまま反映されます。\n元に戻すときはメニュー「費目管理の連動を元に戻す」。', ui.ButtonSet.OK);
  } catch (err) {
    try { kkbApiRestoreMaster_(ss); } catch (e2) { console.error(e2); }
    ui.alert('途中で失敗したため元に戻しました：' + kkbApiErrText_(err));
  } finally {
    lock.releaseLock();
  }
}

// 一覧の数式は重いシートでは計算に時間がかかる（読むと「読み込み中」で空に見える）。空でなくなるまで少し待つ
function kkbApiWaitLists_(ss) {
  let empty = [];
  for (let i = 0; i < 12; i++) {
    SpreadsheetApp.flush();
    empty = KKB_MS.KUBUN.filter(k => !kkbApiCandidates_(ss, k.kubun).length).map(k => k.kubun);
    if (!kkbApiListRange_(ss, KKB_MS.METHOD_COL).getValues().some(r => String(r[0]).trim())) empty.push('入出金方法');
    if (!empty.length) return empty;
    Utilities.sleep(5000);
  }
  // 待っても空なら、その一覧の先頭セルの数式と表示を添える
  return empty.map(name => {
    const k = KKB_MS.KUBUN.filter(x => x.kubun === name)[0], col = k ? k.col : KKB_MS.METHOD_COL;
    const c = ss.getSheetByName(KKB_MS.DD).getRange(col + '2');
    return name + '（' + col + '2 表示「' + c.getDisplayValue() + '」）';
  });
}

// 移行前の数式・入力規則・隠す設定に戻す
function kkbApiRestoreMaster_(ss) {
  const props = PropertiesService.getScriptProperties();
  const saved = JSON.parse(props.getProperty(KKB_MS.BACKUP) || '{}');
  if (!saved.formulas) throw new Error('移行前の控えがありません');
  // 隠す設定は、シートの今の状態をアプリの隠す設定として残す
  if (kkbApiMasterOn_()) { try { props.setProperty('KKB_HIDDEN', JSON.stringify(kkbApiHiddenFromSheet_(ss))); } catch (e) { console.error(e); } }
  else if (saved.hidden) props.setProperty('KKB_HIDDEN', JSON.stringify(saved.hidden));
  props.deleteProperty(KKB_MS.FLAG);
  Object.keys(saved.formulas).forEach(key => {
    const i = key.indexOf('!'), s = ss.getSheetByName(key.slice(0, i));
    if (s && saved.formulas[key]) s.getRange(key.slice(i + 1)).setFormula(saved.formulas[key]);
  });
  SpreadsheetApp.flush();
  // 入力規則を、各行の候補の列（移行前と同じ形）に戻す
  const methodOld = SpreadsheetApp.newDataValidation().requireValueInRange(ss.getSheetByName('費目管理').getRange('Q3:Q30'), true).setAllowInvalid(false).build();
  const span = { '01_Raw_Data': ['N', 'AP'], '固定コピペ用': ['I', 'Z'], '03_Card_Import': ['O', 'AQ'] };
  KKB_MS.SHEETS.forEach(t => {
    const s = ss.getSheetByName(t.name);
    if (!s) return;
    const n = t.last - t.first + 1, sp = span[t.name];
    s.getRange(t.first, t.himoku, n, 1).setDataValidations(Array.from({ length: n }, (_, i) =>
      [SpreadsheetApp.newDataValidation().requireValueInRange(s.getRange(sp[0] + (t.first + i) + ':' + sp[1] + (t.first + i)), true).setAllowInvalid(false).build()]));
    s.getRange(t.first, t.method, n, 1).setDataValidation(methodOld);
  });
  // 追加した一覧と隠す欄を外す
  const dd = ss.getSheetByName(KKB_MS.DD), fm = ss.getSheetByName('費目管理');
  kkbApiListCells_().forEach(c => dd.getRange(c.col + '1:' + c.col + '2').clearContent());
  kkbApiMasterFlagCells_().forEach(f => { fm.getRange(f.a1).clearDataValidations().clearContent(); fm.getRange(f.head).clearContent(); });
  SpreadsheetApp.flush();
}

function kkbApiRestoreMasterMenu() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('費目管理の連動を元に戻しますか？', '移行前の費目候補の列と入力規則に戻します。今の「' + KKB_MS.HIDE_HEADER + '」の設定はアプリの隠す設定として残します。',
    ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) { ui.alert('ほかの処理中です'); return; }
  try { kkbApiRestoreMaster_(SpreadsheetApp.getActive()); ui.alert('元に戻しました'); }
  catch (err) { ui.alert('戻せませんでした：' + kkbApiErrText_(err)); }
  finally { lock.releaseLock(); }
}

// ---- 過去の月の予算を固定 ----
function kkbApiPastSheets_(ss) {
  const tz = ss.getSpreadsheetTimeZone(), now = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  return ss.getSheets().filter(s => /^\d{1,2}月$/.test(s.getName())).map(s => {
    const j = s.getRange('J3').getValue();
    return { sheet: s, ym: j instanceof Date ? Utilities.formatDate(j, tz, 'yyyy-MM') : '' };
  }).filter(p => p.ym && p.ym < now);
}

function kkbApiFrozenFormulas_(sheet) {
  return PropertiesService.getScriptProperties().getProperty('KKB_FROZEN_' + sheet.getName());
}

function kkbApiFreeze_(sheet) {
  if (kkbApiFrozenFormulas_(sheet)) return false;
  const range = sheet.getRange('G23:G43'), formulas = range.getFormulas();
  if (!formulas.some(x => x[0].indexOf('$M$2') >= 0)) throw new Error(sheet.getName() + 'の予算の数式が想定と違います');
  const pairs = sheet.getRange('F23:G43').getValues().filter(x => x[0] !== '')
    .map(x => '"' + String(x[0]).replace(/"/g, '""') + '",' + (Number(x[1]) || 0)).join(';');
  PropertiesService.getScriptProperties().setProperty('KKB_FROZEN_' + sheet.getName(), JSON.stringify(formulas));
  range.setFormulas(formulas.map((_, i) => ['=IF(F' + (23 + i) + '="","",IFERROR(VLOOKUP(F' + (23 + i) + ',{' + pairs + '},2,FALSE),0))']));
  return true;
}

function kkbApiUnfreeze_(sheet) {
  const saved = kkbApiFrozenFormulas_(sheet);
  if (!saved) return;
  sheet.getRange('G23:G43').setFormulas(JSON.parse(saved));
  PropertiesService.getScriptProperties().deleteProperty('KKB_FROZEN_' + sheet.getName());
}

// 過去の月を固定してから予算を変え、過去の月の数字が1つでも動いたら全部元に戻す。
function kkbApiKeepPast_(ss, change) {
  const past = kkbApiPastSheets_(ss);
  // スプレッドシートで費目が増減して金額0の行が増減したり行が詰まったりしても、金額が変わらなければ「動いた」としない
  const numbers = s => JSON.stringify([].concat.apply([], s.getDataRange().getValues()).filter(x => typeof x === 'number' && x !== 0).sort((a, b) => a - b));
  const before = past.map(p => numbers(p.sheet));
  const fm = ss.getSheetByName('費目管理');
  const original = fm.getDataRange().getValues();
  const fresh = past.filter(p => kkbApiFreeze_(p.sheet));
  SpreadsheetApp.flush();
  const r = change();
  if (r.status !== 'done' || r.repeated) { fresh.forEach(p => kkbApiUnfreeze_(p.sheet)); return r; }
  SpreadsheetApp.flush();
  const moved = past.filter((p, i) => numbers(p.sheet) !== before[i]);
  if (!moved.length) return r;
  const range = fm.getDataRange(), nowValues = range.getValues(), nowFormulas = range.getFormulas();
  nowValues.forEach((line, y) => line.forEach((v, x) => {
    if (nowFormulas[y][x] || y >= original.length || x >= original[y].length) return;
    if (!kkbApiSameCell_(v, original[y][x])) fm.getRange(y + 1, x + 1).setValue(original[y][x]);
  }));
  fresh.forEach(p => kkbApiUnfreeze_(p.sheet));
  return { status: 'error', message: moved.map(p => p.sheet.getName()).join('・') + 'の数字が変わるため、変更を取り消しました' };
}

function kkbApiFrozenBudgets_(ss) {
  const out = {};
  kkbApiPastSheets_(ss).filter(p => kkbApiFrozenFormulas_(p.sheet)).forEach(p => {
    const m = {};
    p.sheet.getRange('F23:G43').getValues().forEach(x => { if (x[0] !== '') m[x[0]] = Number(x[1]) || 0; });
    out[p.ym] = m;
  });
  return out;
}

function kkbApiUnfreezeAll() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('月シートの予算の固定を解除しますか？', '過去の月の予算が、費目管理の現在の金額に戻ります。新しい年度に月シートを使い回すときに実行します。', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  SpreadsheetApp.getActive().getSheets().forEach(kkbApiUnfreeze_);
  ui.alert('解除しました');
}


// ---- 重さの診断（読み取りのみ） ----
// 値は読まない。シートごとの大きさ・数式の数・同じ形の数式・重い関数・条件付き書式・入力規則を数える。
// 数式の中の文字列（費目名など）は「"…"」に伏せて書き出す。
function kkbApiInspectWeight() {
  const ss = SpreadsheetApp.getActive();
  const NL = String.fromCharCode(10);
  const HEAVY = ['INDIRECT', 'OFFSET', 'TODAY', 'NOW', 'RAND', 'IMPORTRANGE', 'QUERY', 'ARRAYFORMULA', 'FILTER', 'SORT', 'UNIQUE',
    'SUMPRODUCT', 'COUNTIFS', 'COUNTIF', 'SUMIFS', 'SUMIF', 'VLOOKUP', 'XLOOKUP', 'MATCH', 'REGEXMATCH', 'TEXTJOIN', 'LAMBDA', 'MAP', 'BYROW'];
  const mask = f => f.replace(/"(?:[^"]|"")*"/g, '"…"');
  const out = [];
  let allCells = 0, allFormulas = 0;
  out.push('# 重さの診断 ' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy/MM/dd HH:mm'));
  out.push('再計算の設定: ' + ss.getRecalculationInterval());
  const rows = [];
  ss.getSheets().forEach(sh => {
    const maxR = sh.getMaxRows(), maxC = sh.getMaxColumns(), lastR = sh.getLastRow(), lastC = sh.getLastColumn();
    allCells += maxR * maxC;
    let formulas = 0, wholeCol = 0;
    const heavy = {}, shapes = {};
    if (lastR && lastC) {
      sh.getRange(1, 1, lastR, lastC).getFormulasR1C1().forEach(line => line.forEach(f => {
        if (!f) return;
        formulas++;
        const up = f.toUpperCase();
        HEAVY.forEach(h => { if (new RegExp('\\b' + h + '\\(').test(up)) heavy[h] = (heavy[h] || 0) + 1; });
        if (/C\d*:C\d*(?![\dR])|R\d*:R\d*(?![\dC])/.test(f) || /!?C\[?-?\d*\]?:C\[?-?\d*\]?(?!R)/.test(f)) wholeCol++;
        const k = mask(f);
        shapes[k] = (shapes[k] || 0) + 1;
      }));
    }
    allFormulas += formulas;
    const cf = sh.getConditionalFormatRules();
    let dv = 0;
    try { if (lastR && lastC) sh.getRange(1, 1, lastR, lastC).getDataValidations().forEach(l => l.forEach(x => { if (x) dv++; })); } catch (e) { dv = -1; }
    rows.push({ name: sh.getName(), maxR, maxC, lastR, lastC, formulas, wholeCol, heavy, shapes, cf: cf.length,
      cfRanges: cf.reduce((s, r) => s + r.getRanges().reduce((t, g) => t + g.getNumRows() * g.getNumColumns(), 0), 0),
      dv, charts: sh.getCharts().length, hidden: sh.isSheetHidden() });
  });
  out.push('シート数: ' + rows.length + ' ／ 全セル数（空の行・列を含む）: ' + allCells + ' ／ 数式の数: ' + allFormulas);
  out.push('');
  rows.sort((a, b) => b.formulas - a.formulas).forEach(r => {
    out.push('## ' + r.name + (r.hidden ? '（非表示）' : ''));
    out.push('大きさ ' + r.maxR + '行×' + r.maxC + '列（使用 ' + r.lastR + '行×' + r.lastC + '列）／数式 ' + r.formulas +
      '／列全体の参照を含む数式 ' + r.wholeCol + '／条件付き書式 ' + r.cf + '件（' + r.cfRanges + 'セル）／入力規則 ' + r.dv + 'セル／グラフ ' + r.charts);
    const h = Object.keys(r.heavy).sort((a, b) => r.heavy[b] - r.heavy[a]).map(k => k + ' ' + r.heavy[k]);
    if (h.length) out.push('関数: ' + h.join('、'));
    Object.keys(r.shapes).sort((a, b) => r.shapes[b] - r.shapes[a]).slice(0, 4).forEach(k => {
      out.push('  ×' + r.shapes[k] + '  ' + (k.length > 300 ? k.slice(0, 300) + '…' : k));
    });
  });
  const text = out.join(NL).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput('<textarea style="width:100%;height:420px" readonly onclick="this.select()">' + text + '</textarea><p>クリックして全選択し、コピーしてください。</p>').setWidth(760).setHeight(520),
    '重さの診断（読み取りのみ）');
}

// ---- 軽くする：照合済みのカード明細の J列を値に固定 ----
// 照合の数式は 01_Raw_Data が変わるたびに全行で計算し直される。結果が変わらない「取込済・対象外・重複除外」の行だけ、
// 今の結果の値に置き換える。まだ取り込んでいない行（要確認・取込可）は数式のまま残す。元の数式は控えておき、戻せる。
const KKB_CARDJ = { COL: 10, STATUS: 11, FORMULA: 'KKB_CARDJ_R1C1', ROWS: 'KKB_CARDJ_ROWS' };

function kkbApiCardFrozenRows_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(KKB_CARDJ.ROWS) || '[]'); } catch (e) { return []; }
}

/** 対象の行を値に固定し、固定した行数を返す。数式が想定と違う行には触らない。 */
function kkbApiCardFreeze_(ss) {
  const props = PropertiesService.getScriptProperties();
  const sheet = requireSheetV3_(ss, KKV3_CARD.IMPORT_SHEET);
  const first = KKV3_CARD.FIRST_DATA_ROW, n = Math.max(sheet.getLastRow() - first + 1, 0);
  if (!n) return 0;
  const formulas = sheet.getRange(first, KKB_CARDJ.COL, n, 1).getFormulasR1C1().map(x => x[0]);
  const heads = sheet.getRange(first, 1, n, KKB_CARDJ.STATUS).getValues();
  // 控える数式は、いちばん多く使われている形（全行同じ形のはず）
  let base = props.getProperty(KKB_CARDJ.FORMULA);
  if (!base) {
    const count = {};
    formulas.forEach(f => { if (f) count[f] = (count[f] || 0) + 1; });
    base = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    if (!base) return 0;
  }
  const target = [];
  formulas.forEach((f, i) => {
    const status = String(heads[i][KKB_CARDJ.STATUS - 1]).trim();
    if (f === base && heads[i][0] && status && KKB_CSV.PENDING.indexOf(status) < 0) target.push(i);
  });
  if (!target.length) return 0;
  SpreadsheetApp.flush();
  const values = sheet.getRange(first, KKB_CARDJ.COL, n, 1).getValues();
  // 続いている行はまとめて書く
  const runs = [];
  target.forEach(i => { const last = runs[runs.length - 1]; if (last && last[1] === i - 1) last[1] = i; else runs.push([i, i]); });
  runs.forEach(([a, b]) => sheet.getRange(first + a, KKB_CARDJ.COL, b - a + 1, 1).setValues(values.slice(a, b + 1)));
  const rows = kkbApiCardFrozenRows_().concat(runs.map(([a, b]) => [first + a, first + b]));
  props.setProperty(KKB_CARDJ.FORMULA, base);
  props.setProperty(KKB_CARDJ.ROWS, JSON.stringify(rows));
  return target.length;
}

function kkbApiFreezeCardMatch() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('照合済みのカード明細を値に固定しますか？',
    '03_Card_Import の J列（照合・重複判定）のうち、取込済・対象外・重複除外の行を、今の結果の値に置き換えます。' + String.fromCharCode(10) +
    '要確認・取込可の行は数式のまま残します。元の数式は控えておき、メニュー「カード明細の照合の固定を解除」で戻せます。', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) { ui.alert('ほかの処理が動いています。少し待ってからもう一度実行してください'); return; }
  try { ui.alert('固定しました：' + kkbApiCardFreeze_(SpreadsheetApp.getActive()) + '行'); }
  finally { lock.releaseLock(); }
}

function kkbApiUnfreezeCardMatch() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('カード明細の照合の固定を解除しますか？', '値に固定した J列を、元の数式に戻します。計算は重くなります。', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const props = PropertiesService.getScriptProperties(), base = props.getProperty(KKB_CARDJ.FORMULA);
  if (!base) { ui.alert('固定している行はありません'); return; }
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) { ui.alert('ほかの処理が動いています。少し待ってからもう一度実行してください'); return; }
  try {
    const sheet = requireSheetV3_(SpreadsheetApp.getActive(), KKV3_CARD.IMPORT_SHEET);
    let count = 0;
    kkbApiCardFrozenRows_().forEach(([a, b]) => {
      sheet.getRange(a, KKB_CARDJ.COL, b - a + 1, 1).setFormulasR1C1(Array.from({ length: b - a + 1 }, () => [base]));
      count += b - a + 1;
    });
    props.deleteProperty(KKB_CARDJ.ROWS);
    props.deleteProperty(KKB_CARDJ.FORMULA);
    ui.alert('元の数式に戻しました：' + count + '行');
  } finally { lock.releaseLock(); }
}


// ---- 月シートの数式を書き出す（読み取りのみ） ----
// 月シートの集計を軽くする準備。4月シートの数式を形ごとに1つずつ、伏せずに書き出す。
// あわせて 01_Raw_Data・96_Drop_Down の見出しと数式を書き出す。値（明細）は読まない。
function kkbApiInspectMonth() {
  const ss = SpreadsheetApp.getActive(), NL = String.fromCharCode(10), out = [];
  const shapes = (name, rows) => {
    const sh = ss.getSheetByName(name);
    if (!sh) { out.push('## ' + name + '：なし'); return; }
    const r = Math.min(sh.getLastRow(), rows || sh.getLastRow()), c = sh.getLastColumn();
    out.push('## ' + name + '（使用 ' + sh.getLastRow() + '行×' + c + '列）');
    const range = sh.getRange(1, 1, r, c), f1 = range.getFormulasR1C1(), fa = range.getFormulas();
    const seen = {};
    f1.forEach((line, y) => line.forEach((f, x) => {
      if (!f) return;
      const a1 = sh.getRange(y + 1, x + 1).getA1Notation();
      if (!seen[f]) seen[f] = { first: a1, last: a1, n: 0, a: fa[y][x] };
      seen[f].n++; seen[f].last = a1;
    }));
    Object.keys(seen).forEach(k => out.push('[' + seen[k].first + '…' + seen[k].last + ' ×' + seen[k].n + '] ' + seen[k].a));
  };
  const heads = (name, rows) => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const v = sh.getRange(1, 1, rows, sh.getLastColumn()).getValues();
    v.forEach((line, y) => out.push(name + ' ' + (y + 1) + '行目: ' + line.map((x, i) => x === '' ? '' : sh.getRange(y + 1, i + 1).getA1Notation() + '=' + (x instanceof Date ? '日付' : x)).filter(Boolean).join(' ¦ ')));
  };
  shapes('4月');
  heads('01_Raw_Data', 4);
  shapes('01_Raw_Data', 6);
  heads('96_Drop_Down', 1);
  shapes('96_Drop_Down');
  const text = out.join(NL).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput('<textarea style="width:100%;height:420px" readonly onclick="this.select()">' + text + '</textarea><p>クリックして全選択し、コピーしてください。</p>').setWidth(760).setHeight(520),
    '月シートの数式（読み取りのみ）');
}

// ---- 軽くする：月シートの集計 ----
// 各月の実績は「区分の費目を 96_Drop_Down から探し、費目ごとに 01_Raw_Data 全体を集計して足す」数式で、
// 01_Raw_Data が変わるたびに12か月分が計算し直されて重い。01_Raw_Data の空き列（AE）に月別表示名を1つの数式で出し、
// 月シートはその列で1回だけ集計する形に置き換える。置き換えの前後で月シート・年間推移・特別費管理の値を全部比べ、
// 1つでも違えば元に戻す。元の数式は控え、メニューで戻せる。
const KKB_LITE = {
  PROP: 'KKB_MONTH_LITE',
  COL: 'AE', HEAD: '月別表示名（集計用）',
  GROUP: "=ARRAYFORMULA(IF($B$5:$B$4986=\"\",\"\",IFERROR(VLOOKUP($D$5:$D$4986&\"|\"&$E$5:$E$4986,{'96_Drop_Down'!$G$2:$G$200&\"|\"&'96_Drop_Down'!$H$2:$H$200,'96_Drop_Down'!$N$2:$N$200},2,FALSE),\"\")))",
  // 範囲, 見出しの列, 区分。sum は金額、methods は特別費の支払方法
  RANGES: [
    ['D7:D16', 'B', '収入', 'sum'], ['H7:H16', 'F', '先取り貯金・投資', 'sum'],
    ['D23:D43', 'B', '支出（固定費）', 'sum'], ['H23:H43', 'F', '支出（変動費）', 'sum'],
    ['D48:D65', 'B', '支出（特別費）', 'sum'], ['C48:C65', 'B', '支出（特別費）', 'methods'],
  ],
};

function kkbApiLiteFormula_(spec, row) {
  const [, col, kubun, kind] = spec, label = col + row;
  const R = "'01_Raw_Data'!", ym = 'TEXT($J$3,"yyyy-mm")';
  if (kind === 'sum') return '=IF(' + label + '="","",IFERROR(SUMIFS(' + R + '$C$5:$C$4986,' + R + '$J$5:$J$4986,' + ym + ',' + R + '$D$5:$D$4986,"' + kubun + '",' + R + '$AE$5:$AE$4986,' + label + '),0))';
  return '=IF(' + label + '="","",IFERROR(TEXTJOIN("・",TRUE,UNIQUE(FILTER(' + R + '$F$5:$F$4986,' + R + '$J$5:$J$4986=' + ym + ',' + R + '$D$5:$D$4986="' + kubun + '",' + R + '$AE$5:$AE$4986=' + label + ',' + R + '$F$5:$F$4986<>""))),""))';
}

function kkbApiLiteSheets_(ss) {
  return ss.getSheets().filter(s => /^\d{1,2}月$/.test(s.getName()));
}

function kkbApiLiteSnapshot_(ss) {
  const names = kkbApiLiteSheets_(ss).map(s => s.getName()).concat(['年間推移', '特別費管理']);
  const snap = {};
  names.forEach(n => { const s = ss.getSheetByName(n); if (s && s.getLastRow()) snap[n] = s.getRange(1, 1, s.getLastRow(), s.getLastColumn()).getValues(); });
  return snap;
}

function kkbApiLiteDiff_(a, b) {
  const out = [];
  Object.keys(a).forEach(n => a[n].forEach((line, y) => line.forEach((v, x) => {
    const w = b[n] && b[n][y] ? b[n][y][x] : undefined;
    const same = v instanceof Date && w instanceof Date ? v.getTime() === w.getTime() : typeof v === 'number' && typeof w === 'number' ? Math.abs(v - w) < 1e-6 : v === w;
    if (!same && out.length < 15) { let c = '', k = x + 1; while (k) { c = String.fromCharCode(65 + (k - 1) % 26) + c; k = Math.floor((k - 1) / 26); } out.push(n + '!' + c + (y + 1)); }
  })));
  return out;
}

function kkbApiLightenMonths() {
  const ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive(), NL = String.fromCharCode(10);
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(KKB_LITE.PROP)) { ui.alert('すでに置き換え済みです'); return; }
  if (ui.alert('月シートの集計を軽くしますか？',
    '01_Raw_Data の AE列に月別表示名を出す数式を足し、各月の実績（D・H列）と特別費の支払方法（C48:C65）の数式を、その列を使う形に置き換えます。' + NL +
    '置き換えの前後で、月シート・年間推移・特別費管理の値を全部比べ、1つでも違えば元に戻します。' + NL +
    '元の数式は控えておき、メニュー「月シートの集計を元に戻す」で戻せます。1〜2分かかることがあります。', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) { ui.alert('ほかの処理が動いています。少し待ってからもう一度実行してください'); return; }
  try {
    const raw = requireSheetV3_(ss, KKB_API.RAW_SHEET), months = kkbApiLiteSheets_(ss);
    // 確認1：AE列が空いていること
    if (raw.getRange('AE1:AE4986').getValues().some(r => r[0] !== '') || raw.getRange('AE1:AE4986').getFormulas().some(r => r[0])) {
      ui.alert('01_Raw_Data の AE列が空いていないため、中止しました'); return;
    }
    // 確認2：置き換える数式が、どの月も同じ形であること
    const originals = {};
    for (const spec of KKB_LITE.RANGES) {
      let base = null;
      for (const s of months) {
        const f = s.getRange(spec[0]).getFormulasR1C1().map(r => r[0]);
        base = base || f[0];
        if (!base || f.some(x => x !== base) || !/MAP\(|XLOOKUP\(/.test(base)) { ui.alert(s.getName() + ' の ' + spec[0] + ' の数式が想定と違うため、中止しました'); return; }
      }
      originals[spec[0]] = base;
    }
    const before = kkbApiLiteSnapshot_(ss);
    raw.getRange(KKB_LITE.COL + '4').setValue(KKB_LITE.HEAD);
    raw.getRange(KKB_LITE.COL + '5').setFormula(KKB_LITE.GROUP);
    // 行ごとに見出しのセルが変わるので、1行ずつ数式を作って入れる
    months.forEach(s => KKB_LITE.RANGES.forEach(spec => {
      const r = s.getRange(spec[0]), top = r.getRow();
      r.setFormulas(Array.from({ length: r.getNumRows() }, (_, i) => [kkbApiLiteFormula_(spec, top + i)]));
    }));
    SpreadsheetApp.flush();
    const diff = kkbApiLiteDiff_(before, kkbApiLiteSnapshot_(ss));
    if (diff.length) {
      months.forEach(s => KKB_LITE.RANGES.forEach(spec => { const r = s.getRange(spec[0]); r.setFormulasR1C1(Array.from({ length: r.getNumRows() }, () => [originals[spec[0]]])); }));
      raw.getRange(KKB_LITE.COL + '4:' + KKB_LITE.COL + '5').clearContent();
      SpreadsheetApp.flush();
      ui.alert('値が変わる場所があったため、元に戻しました。' + NL + '違った場所（最大15か所）：' + NL + diff.join(NL));
      return;
    }
    props.setProperty(KKB_LITE.PROP, JSON.stringify(originals));
    ui.alert('置き換えました。月シート・年間推移・特別費管理の値は、置き換え前とすべて同じです。');
  } finally { lock.releaseLock(); }
}

function kkbApiRestoreMonths() {
  const ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties(), saved = props.getProperty(KKB_LITE.PROP);
  if (!saved) { ui.alert('置き換えていないため、戻すものはありません'); return; }
  if (ui.alert('月シートの集計を元に戻しますか？', '各月の数式を置き換え前の形に戻し、01_Raw_Data の AE列の数式を消します。計算は重くなります。', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) { ui.alert('ほかの処理が動いています。少し待ってからもう一度実行してください'); return; }
  try {
    const originals = JSON.parse(saved);
    kkbApiLiteSheets_(ss).forEach(s => Object.keys(originals).forEach(a1 => { const r = s.getRange(a1); r.setFormulasR1C1(Array.from({ length: r.getNumRows() }, () => [originals[a1]])); }));
    requireSheetV3_(ss, KKB_API.RAW_SHEET).getRange(KKB_LITE.COL + '4:' + KKB_LITE.COL + '5').clearContent();
    props.deleteProperty(KKB_LITE.PROP);
    ui.alert('元に戻しました');
  } finally { lock.releaseLock(); }
}
