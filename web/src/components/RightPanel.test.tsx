import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RightPanel } from './RightPanel';

beforeEach(() => {
  localStorage.clear();
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

  it('clamps width to the 160-600 bounds', () => {
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
