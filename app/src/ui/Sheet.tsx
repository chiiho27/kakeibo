import * as Dialog from '@radix-ui/react-dialog';
import { Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/** ボトムシート（PC では中央のダイアログ）。フォーカス管理・Esc・読み上げは Radix に任せる。 */
export function Sheet({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="sheet" aria-describedby={undefined}>
          <div className="row" style={{ alignItems: 'center' }}>
            <Dialog.Title asChild><h3>{title}</h3></Dialog.Title>
            <Dialog.Close className="iconbtn" aria-label="閉じる"><X size={24} strokeWidth={2} /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 検索つきの選択リスト */
export function PickList({ items, selected, onPick, render }: {
  items: string[]; selected: string; onPick: (v: string) => void; render?: (v: string) => ReactNode;
}) {
  const [q, setQ] = useState('');
  const shown = q ? items.filter(i => i.toLowerCase().includes(q.toLowerCase())) : items;
  return (
    <>
      {items.length > 8 && (
        <label className="datebox" style={{ marginBottom: 16 }}>
          <span className="sr">検索</span>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="検索" />
          <span className="iconbtn" aria-hidden="true"><Search size={24} strokeWidth={2} /></span>
        </label>
      )}
      <div className="list" role="listbox" aria-label="候補">
        {shown.map(v => (
          <button key={v} type="button" role="option" aria-selected={v === selected} className="li pick" onClick={() => onPick(v)}>
            <span className="grow">{render ? render(v) : v}</span>{v === selected && <span>✓ 選択中</span>}
          </button>
        ))}
        {!shown.length && <p className="li muted">該当なし</p>}
      </div>
    </>
  );
}
