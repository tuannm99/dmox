import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from './TabBar';

// jsdom doesn't implement Element.scrollIntoView — polyfill so it can be spied on.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

const tabs = [
  { path: 'local/a.md', preview: false },
  { path: 'local/sub/b.go', preview: true },
];

function setup(overrides = {}) {
  const handlers = {
    onSelect: vi.fn(), onClose: vi.fn(), onCloseOthers: vi.fn(),
    onCloseAll: vi.fn(), onCopyPath: vi.fn(), onReveal: vi.fn(),
    ...overrides,
  };
  const utils = render(<TabBar tabs={tabs} activePath="local/a.md" {...handlers} />);
  return { ...utils, ...handlers };
}

describe('TabBar', () => {
  it('renders nothing when there are no tabs', () => {
    const { container } = render(
      <TabBar tabs={[]} onSelect={vi.fn()} onClose={vi.fn()} onCloseOthers={vi.fn()}
        onCloseAll={vi.fn()} onCopyPath={vi.fn()} onReveal={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows one tab per file by base name, marking the active one', () => {
    setup();
    const active = screen.getByRole('tab', { name: /a\.md/ });
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /b\.go/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('marks a preview tab so it reads as temporary', () => {
    const { container } = setup();
    expect(container.querySelector('.tab.preview')).toHaveTextContent('b.go');
  });

  it('selects a tab on click and closes it on the close button', () => {
    const { onSelect, onClose } = setup();
    fireEvent.click(screen.getByRole('tab', { name: /b\.go/ }));
    expect(onSelect).toHaveBeenCalledWith('local/sub/b.go');
    fireEvent.click(screen.getByRole('button', { name: 'Close b.go' }));
    expect(onClose).toHaveBeenCalledWith('local/sub/b.go');
  });

  it('closes on middle click without also selecting', () => {
    const { onClose, onSelect } = setup();
    fireEvent(
      screen.getByRole('tab', { name: /a\.md/ }),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
    );
    expect(onClose).toHaveBeenCalledWith('local/a.md');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('offers the context menu actions for the right-clicked tab', () => {
    const { onCloseOthers, onCopyPath, onReveal } = setup();
    fireEvent.contextMenu(screen.getByRole('tab', { name: /a\.md/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Others' }));
    expect(onCloseOthers).toHaveBeenCalledWith('local/a.md');

    fireEvent.contextMenu(screen.getByRole('tab', { name: /a\.md/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Path' }));
    expect(onCopyPath).toHaveBeenCalledWith('local/a.md');

    fireEvent.contextMenu(screen.getByRole('tab', { name: /a\.md/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in Explorer' }));
    expect(onReveal).toHaveBeenCalledWith('local/a.md');
  });

  it('does not remount its tabs when the parent re-renders', () => {
    const { container, rerender } = setup();
    const first = container.querySelector('.tab');
    rerender(
      <TabBar tabs={tabs} activePath="local/a.md" onSelect={vi.fn()} onClose={vi.fn()}
        onCloseOthers={vi.fn()} onCloseAll={vi.fn()} onCopyPath={vi.fn()} onReveal={vi.fn()} />
    );
    expect(container.querySelector('.tab')).toBe(first);
  });

  it('scrolls the active tab into view when the active path changes', () => {
    const scrollIntoViewSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { rerender } = setup();
    scrollIntoViewSpy.mockClear(); // ignore the call from the initial mount

    rerender(
      <TabBar tabs={tabs} activePath="local/sub/b.go" onSelect={vi.fn()} onClose={vi.fn()}
        onCloseOthers={vi.fn()} onCloseAll={vi.fn()} onCopyPath={vi.fn()} onReveal={vi.fn()} />
    );

    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    scrollIntoViewSpy.mockRestore();
  });
});
