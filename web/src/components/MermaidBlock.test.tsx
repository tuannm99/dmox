import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"></svg>' }),
  },
}));

import { MermaidBlock } from './MermaidBlock';

const SOURCE = 'graph TD; A-->B;';

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('MermaidBlock', () => {
  it('renders the diagram at 100% by default', async () => {
    render(<MermaidBlock source={SOURCE} />);
    const diagram = await screen.findByTestId('mermaid-svg');
    expect(diagram.style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(screen.getByRole('button', { name: '100%' })).toBeInTheDocument();
  });

  it('zooms in and out via the +/- buttons in fixed 0.25 steps', async () => {
    render(<MermaidBlock source={SOURCE} />);
    const diagram = await screen.findByTestId('mermaid-svg');

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(diagram.style.transform).toBe('translate(0px, 0px) scale(1.25)');
    expect(screen.getByRole('button', { name: '125%' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(diagram.style.transform).toBe('translate(0px, 0px) scale(0.75)');
  });

  it('clamps zoom to the min/max bounds and disables the button at each bound', async () => {
    render(<MermaidBlock source={SOURCE} />);
    const diagram = await screen.findByTestId('mermaid-svg');

    for (let i = 0; i < 20; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    }
    expect(diagram.style.transform).toBe('translate(0px, 0px) scale(4)');
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();

    for (let i = 0; i < 20; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    }
    expect(diagram.style.transform).toBe('translate(0px, 0px) scale(0.5)');
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
  });

  it('resets zoom and pan when the percentage label is clicked', async () => {
    render(<MermaidBlock source={SOURCE} />);
    const diagram = await screen.findByTestId('mermaid-svg');

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(diagram.style.transform).not.toBe('translate(0px, 0px) scale(1)');

    fireEvent.click(screen.getByRole('button', { name: '125%' }));
    expect(diagram.style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(screen.getByRole('button', { name: '100%' })).toBeInTheDocument();
  });

  it('does not zoom or block the page from scrolling on wheel', async () => {
    render(<MermaidBlock source={SOURCE} />);
    const diagram = await screen.findByTestId('mermaid-svg');
    const wrapper = diagram.parentElement!;

    fireEvent.wheel(wrapper, { deltaY: -500 });

    expect(diagram.style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('allows normal vertical page scroll through the diagram at 100% zoom (touch-action: pan-y)', async () => {
    render(<MermaidBlock source={SOURCE} />);
    const diagram = await screen.findByTestId('mermaid-svg');
    expect(diagram.style.touchAction).toBe('pan-y');
  });

  it('takes over touch gestures for drag-to-pan once zoomed in (touch-action: none)', async () => {
    render(<MermaidBlock source={SOURCE} />);
    const diagram = await screen.findByTestId('mermaid-svg');

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(diagram.style.touchAction).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: '125%' })); // reset
    expect(diagram.style.touchAction).toBe('pan-y');
  });

  describe('scroll compensation for the async-render layout shift', () => {
    let computedStyleSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      computedStyleSpy?.mockRestore();
    });

    it('shifts the scroll parent by the exact height delta when the diagram, already scrolled past, grows after render', async () => {
      const mermaid = (await import('mermaid')).default;
      let resolveRender!: (v: any) => void;
      vi.mocked(mermaid.render).mockReturnValueOnce(new Promise((resolve) => (resolveRender = resolve)));

      render(
        <div data-testid="scroll-parent">
          <MermaidBlock source={SOURCE} />
        </div>
      );

      const scrollParent = screen.getByTestId('scroll-parent');
      Object.defineProperty(scrollParent, 'scrollHeight', { value: 2000, configurable: true });
      Object.defineProperty(scrollParent, 'clientHeight', { value: 500, configurable: true });
      scrollParent.scrollTop = 300;
      vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);
      computedStyleSpy = vi
        .spyOn(window, 'getComputedStyle')
        .mockImplementation(
          (el) => ({ overflowY: el === scrollParent ? 'auto' : 'visible' }) as CSSStyleDeclaration
        );

      const diagram = screen.getByTestId('mermaid-svg');
      // Diagram's top sits above the scroll parent's viewport top (-50 <= 0):
      // the page is already scrolled past where this diagram starts.
      let rectCalls = 0;
      vi.spyOn(diagram, 'getBoundingClientRect').mockImplementation(
        () => ({ top: -50, height: rectCalls++ === 0 ? 20 : 620 }) as DOMRect
      );

      resolveRender({ svg: '<svg></svg>' });
      await waitFor(() => expect(diagram.innerHTML).toContain('svg'));

      expect(scrollParent.scrollTop).toBe(300 + (620 - 20));
    });

    it('does not adjust scroll when the diagram has not been scrolled to yet', async () => {
      const mermaid = (await import('mermaid')).default;
      let resolveRender!: (v: any) => void;
      vi.mocked(mermaid.render).mockReturnValueOnce(new Promise((resolve) => (resolveRender = resolve)));

      render(
        <div data-testid="scroll-parent">
          <MermaidBlock source={SOURCE} />
        </div>
      );

      const scrollParent = screen.getByTestId('scroll-parent');
      Object.defineProperty(scrollParent, 'scrollHeight', { value: 2000, configurable: true });
      Object.defineProperty(scrollParent, 'clientHeight', { value: 500, configurable: true });
      scrollParent.scrollTop = 300;
      vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);
      computedStyleSpy = vi
        .spyOn(window, 'getComputedStyle')
        .mockImplementation(
          (el) => ({ overflowY: el === scrollParent ? 'auto' : 'visible' }) as CSSStyleDeclaration
        );

      const diagram = screen.getByTestId('mermaid-svg');
      // Diagram's top is below the scroll parent's viewport top (200 > 0):
      // still ahead of the user, not yet reached.
      let rectCalls = 0;
      vi.spyOn(diagram, 'getBoundingClientRect').mockImplementation(
        () => ({ top: 200, height: rectCalls++ === 0 ? 20 : 620 }) as DOMRect
      );

      resolveRender({ svg: '<svg></svg>' });
      await waitFor(() => expect(diagram.innerHTML).toContain('svg'));

      expect(scrollParent.scrollTop).toBe(300);
    });
  });

  it('toggles to a code view showing the raw source, hiding the zoom controls, and back', async () => {
    render(<MermaidBlock source={SOURCE} />);
    const diagram = await screen.findByTestId('mermaid-svg');

    fireEvent.click(screen.getByRole('button', { name: 'View Code' }));

    expect(diagram).toHaveAttribute('hidden');
    expect(screen.getByText(SOURCE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\d+%$/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View Diagram' }));
    expect(diagram).not.toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
  });

  it('preserves the rendered diagram across a code-view toggle instead of re-rendering it', async () => {
    render(<MermaidBlock source={SOURCE} />);
    const diagram = await screen.findByTestId('mermaid-svg');
    expect(diagram.innerHTML).not.toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'View Code' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Diagram' }));

    // Same node reference as the initial query, not a re-query — this is
    // what actually proves it was never unmounted (a re-query would still
    // pass even if the div had been torn down and recreated fresh).
    expect(diagram.innerHTML).not.toBe('');
    expect(diagram.isConnected).toBe(true);
  });

  it('copies the raw source to the clipboard and shows brief confirmation', async () => {
    render(<MermaidBlock source={SOURCE} />);
    await screen.findByTestId('mermaid-svg');

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SOURCE));
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument();
  });

  it('shows a parse error message instead of crashing when mermaid fails to render', async () => {
    const mermaid = (await import('mermaid')).default;
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('Parse error on line 3'));
    render(<MermaidBlock source="bad syntax" />);
    expect(await screen.findByText(/Mermaid render failed/)).toBeInTheDocument();
    expect(screen.getByText(/Parse error on line 3/)).toBeInTheDocument();
  });
});
