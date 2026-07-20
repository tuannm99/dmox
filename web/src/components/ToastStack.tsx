import { useEffect } from 'react';
import type { ChangeEvent } from '../datasource/types';

export interface ToastItem {
  id: string;
  sourceId: string;
  path: string;
  op: ChangeEvent['op'];
}

const AUTO_DISMISS_MS = 4000;

function opLabel(op: ChangeEvent['op']): string {
  switch (op) {
    case 'create':
      return 'created';
    case 'delete':
      return 'deleted';
    default:
      return 'modified';
  }
}

export function ToastStack({
  items,
  onDismiss,
  onViewDiff,
}: {
  items: ToastItem[];
  onDismiss: (id: string) => void;
  onViewDiff: (item: ToastItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="toast-stack">
      {items.map((item) => (
        <ToastItemView key={item.id} item={item} onDismiss={onDismiss} onViewDiff={onViewDiff} />
      ))}
    </div>
  );
}

function ToastItemView({
  item,
  onDismiss,
  onViewDiff,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
  onViewDiff: (item: ToastItem) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  return (
    <div className="toast" role="status">
      <span className="toast-text">
        {item.path} {opLabel(item.op)}
      </span>
      {item.op !== 'delete' && (
        <button type="button" className="toast-action" onClick={() => onViewDiff(item)}>
          View diff
        </button>
      )}
      <button type="button" className="toast-dismiss" aria-label="Dismiss" onClick={() => onDismiss(item.id)}>
        ×
      </button>
    </div>
  );
}
