// 01_Raw_Data の B〜I 列に対応する値。日付は時差の影響を受けないよう 'YYYY-MM-DD' 文字列で持つ。
export const KUBUN = ['支出（変動費）', '支出（固定費）', '支出（特別費）', '先取り貯金・投資', '収入'] as const;
export type Kubun = (typeof KUBUN)[number];
export const K_VAR: Kubun = '支出（変動費）';
export const K_INC: Kubun = '収入';
export const K_SAVE: Kubun = '先取り貯金・投資';

export const SATISFACTION = ['◯', '△', '✕'] as const;   // 未選択は 'ー'（既存の値）として保存

/** スプレッドシートから取得した行（正本のコピー） */
export interface SheetRow {
  id: string;          // アプリが追加した行は取引ID、それ以外は内容ハッシュ由来
  date: string;
  amount: number;
  kubun: string;
  himoku: string;
  method: string;
  g: string;           // G 列（詳細）。利用先と詳細が混在する既存欄
  sat: string;
  source: string;
  row?: number;
  hash?: string;       // B〜I 列の内容ハッシュ。修正・削除の競合検知に使う
  pending?: 'pending' | 'unknown' | 'failed'; // 端末の修正がまだスプレッドシートに届いていない
}

/** 送信済み取引の修正・削除（スプレッドシートへ送る形） */
export interface EditOp {
  opId: string;
  type: 'update' | 'delete';
  target: { id: string; hash?: string; row?: number };
  tx?: NewTx;
}

/** 端末で入力した取引 */
export interface NewTx {
  id: string;          // 取引ID（UUID、不変）
  date: string;
  amount: number;
  kubun: Kubun;
  himoku: string;
  method: string;
  place: string;       // 利用先・支払先（任意）
  detail: string;      // 詳細（任意）
  sat: string;         // '' = 未選択
}

/**
 * 未送信キューの1件。
 * pending: まだ送っていない（修正・取消できる）
 * unknown: 送ったが応答が届かなかった（スプレッドシートに入った可能性があるので修正させない）
 * failed:  スプレッドシートが受け付けなかった（理由を表示し、修正して送り直せる）
 */
export interface Op {
  opId: string;
  type: 'add' | 'update' | 'delete';
  tx: NewTx;                // add・update は送る内容。delete は消す取引の内容（表示用）
  target?: { id: string; hash?: string; row?: number }; // update・delete の対象（取得したときの内容ハッシュで競合を検知）
  state: 'pending' | 'unknown' | 'failed';
  createdAt: number;
  error?: string;
}

export interface MasterItem {
  kubun: string;
  himoku: string;
  note: string;
  methods: string[];
  budget: number;      // 月額目安・予算（96_Drop_Down の M 列）
  group: string;       // 月別表示名
  order: number;
  weekly: boolean;     // 週管理対象（費目管理 P 列）
  hidden?: boolean;    // アプリの候補から隠す（集計には含める）
}

export interface Master {
  items: MasterItem[];
  methods: string[];
  hiddenMethods?: string[];
}

export interface Prefs {
  defaultHimoku: string;
  defaultMethod: string;
  quickMethods: string[];
  nmdIcon: string;     // 'lucide:<name>' または絵文字
}

export const DEFAULT_PREFS: Prefs = {
  defaultHimoku: '🍙 食費',
  defaultMethod: '三井住友VISAカード(C)',
  quickMethods: ['三井住友VISAカード(C)', 'PayPay', '現金'],
  nmdIcon: 'lucide:sprout',
};

export type Mode = 'demo' | 'sheet';

export interface Connection {
  mode: Mode;
  url: string;         // Apps Script ウェブアプリの URL（秘密ではない）
  device: string;      // 端末の鍵（接続コードと交換で発行）
}
