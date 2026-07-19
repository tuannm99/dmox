import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RightPanel } from './RightPanel';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty('--right-panel-width');
});

describe('RightPanel', () => {
  it('renders the title, close button, and children', () => {
    render(
      <RightPanel open title="Terminal" onClose={() => {}}>
        <div>panel content</div>
      </RightPanel>
    );
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('panel content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close panel/i })).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <RightPanel open title="Terminal" onClose={onClose}>
        <div>panel content</div>
      </RightPanel>
    );
    fireEvent.click(screen.getByRole('button', { name: /close panel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps children rendered even when closed (hidden via CSS, not unmounted)', () => {
    const { container } = render(
      <RightPanel open={false} title="Terminal" onClose={() => {}}>
        <div>panel content</div>
      </RightPanel>
    );
    expect(screen.getByText('panel content')).toBeInTheDocument();
    expect(container.querySelector('.right-panel')).toHaveClass('closed');
  });

  it('defaults to 260px width and resizes by dragging the left edge, persisting to localStorage', () => {
    render(
      <RightPanel open title="Terminal" onClose={() => {}}>
        <div>panel content</div>
      </RightPanel>
    );
    const handle = screen.getByRole('separator', { name: 'Resize panel' });
    const panel = handle.parentElement as HTMLElement;
    expect(panel.style.width).toBe('260px');

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 50 }); // dragged left by 50 -> grows
    fireEvent.mouseUp(window, { clientX: 50 });

    expect(panel.style.width).toBe('310px');
    expect(localStorage.getItem('dmox-panel-width')).toBe('310');
  });

  it('clamps width to the min bound (160px)', () => {
    render(
      <RightPanel open title="Terminal" onClose={() => {}}>
        <div>panel content</div>
      </RightPanel>
    );
    const handle = screen.getByRole('separator', { name: 'Resize panel' });
    const panel = handle.parentElement as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 1000 }); // dragged right by 900 -> shrinks past min
    fireEvent.mouseUp(window, { clientX: 1000 });

    expect(panel.style.width).toBe('160px');
  });

  it('clamps width to the max bound (1200px) so a wide panel like Terminal can still grow well past a sidebar-sized cap', () => {
    render(
      <RightPanel open title="Terminal" onClose={() => {}}>
        <div>panel content</div>
      </RightPanel>
    );
    const handle = screen.getByRole('separator', { name: 'Resize panel' });
    const panel = handle.parentElement as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 1000 });
    fireEvent.mouseMove(window, { clientX: -5000 }); // dragged left far past max
    fireEvent.mouseUp(window, { clientX: -5000 });

    expect(panel.style.width).toBe('1200px');
  });

  it('publishes its rendered width as --right-panel-width for other fixed-position UI to offset around, and clears it when closed', () => {
    const { rerender } = render(
      <RightPanel open title="Terminal" onClose={() => {}}>
        <div>panel content</div>
      </RightPanel>
    );
    expect(document.documentElement.style.getPropertyValue('--right-panel-width')).toBe('260px');

    rerender(
      <RightPanel open={false} title="Terminal" onClose={() => {}}>
        <div>panel content</div>
      </RightPanel>
    );
    expect(document.documentElement.style.getPropertyValue('--right-panel-width')).toBe('0px');
  });

  it('restores a previously persisted width on mount', () => {
    localStorage.setItem('dmox-panel-width', '400');
    render(
      <RightPanel open title="Terminal" onClose={() => {}}>
        <div>panel content</div>
      </RightPanel>
    );
    const handle = screen.getByRole('separator', { name: 'Resize panel' });
    expect((handle.parentElement as HTMLElement).style.width).toBe('400px');
  });
});
