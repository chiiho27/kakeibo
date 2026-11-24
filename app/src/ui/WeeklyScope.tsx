import { weeklyItems } from '../lib/budget';
import { displayName } from '../lib/display';
import type { Master } from '../lib/types';

/** 費目管理の週管理設定をそのまま表示する。 */
export function WeeklyScope({ master }: { master: Master }) {
  const items = weeklyItems(master).sort((a, b) => a.order - b.order);
  return items.length > 0 ? (
    <details className="weeklyscope">
      <summary>週管理に設定した{items.length}費目</summary>
      <p>{items.map(i => displayName(i.himoku)).join('、')}</p>
    </details>
  ) : null;
}
