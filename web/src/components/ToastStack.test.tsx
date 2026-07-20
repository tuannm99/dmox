import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastStack, type ToastItem } from './ToastStack';

describe('ToastStack', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there are no items', () => {
    const { container } = render(<ToastStack items={[]} onDismiss={vi.fn()} onViewDiff={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a toast with the path and a human-readable op label', () => {
    const items: ToastItem[] = [{ id: '1', sourceId: 'local', path: 'guide.md', op: 'modify' }];
    render(<ToastStack items={items} onDismiss={vi.fn()} onViewDiff={vi.fn()} />);
    expect(screen.getByText(/guide\.md/)).toBeInTheDocument();
    expect(screen.getByText(/modified/)).toBeInTheDocument();
  });

  it('shows a "View diff" action for modify/create but not delete', () => {
    const items: ToastItem[] = [
      { id: '1', sourceId: 'local', path: 'a.md', op: 'modify' },
      { id: '2', sourceId: 'local', path: 'b.md', op: 'delete' },
    ];
    render(<ToastStack items={items} onDismiss={vi.fn()} onViewDiff={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /view diff/i })).toHaveLength(1);
  });

  it('calls onViewDiff with the clicked item', () => {
    const items: ToastItem[] = [{ id: '1', sourceId: 'local', path: 'a.md', op: 'create' }];
    const onViewDiff = vi.fn();
    render(<ToastStack items={items} onDismiss={vi.fn()} onViewDiff={onViewDiff} />);
    fireEvent.click(screen.getByRole('button', { name: /view diff/i }));
    expect(onViewDiff).toHaveBeenCalledWith(items[0]);
  });

  it('calls onDismiss when the dismiss button is clicked', () => {
    const items: ToastItem[] = [{ id: '1', sourceId: 'local', path: 'a.md', op: 'modify' }];
    const onDismiss = vi.fn();
    render(<ToastStack items={items} onDismiss={onDismiss} onViewDiff={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith('1');
  });

  it('auto-dismisses after 4 seconds', () => {
    const items: ToastItem[] = [{ id: '1', sourceId: 'local', path: 'a.md', op: 'modify' }];
    const onDismiss = vi.fn();
    render(<ToastStack items={items} onDismiss={onDismiss} onViewDiff={vi.fn()} />);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    expect(onDismiss).toHaveBeenCalledWith('1');
  });
});
