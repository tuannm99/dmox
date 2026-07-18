import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"></svg>' }),
  },
}));

import { MermaidBlock } from './MermaidBlock';

describe('MermaidBlock', () => {
  it('zooms in on scroll and shows a reset button once zoomed', async () => {
    render(<MermaidBlock source="graph TD; A-->B;" />);
    const diagram = await screen.findByTestId('mermaid-svg');

    expect(diagram.style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(screen.queryByRole('button', { name: /reset zoom/i })).not.toBeInTheDocument();

    fireEvent.wheel(diagram.parentElement!, { deltaY: -100 });

    expect(diagram.style.transform).toMatch(/scale\(1\.1[0-9]*\)/);
    expect(screen.getByRole('button', { name: /reset zoom/i })).toBeInTheDocument();
  });

  it('clamps zoom to the max scale', async () => {
    render(<MermaidBlock source="graph TD; A-->B;" />);
    const diagram = await screen.findByTestId('mermaid-svg');
    const wrapper = diagram.parentElement!;

    for (let i = 0; i < 50; i++) {
      fireEvent.wheel(wrapper, { deltaY: -1000 });
    }

    expect(diagram.style.transform).toBe('translate(0px, 0px) scale(4)');
  });

  it('resets zoom and pan when the reset button is clicked', async () => {
    render(<MermaidBlock source="graph TD; A-->B;" />);
    const diagram = await screen.findByTestId('mermaid-svg');
    const wrapper = diagram.parentElement!;

    fireEvent.wheel(wrapper, { deltaY: -500 });
    expect(diagram.style.transform).not.toBe('translate(0px, 0px) scale(1)');

    fireEvent.click(screen.getByRole('button', { name: /reset zoom/i }));
    expect(diagram.style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(screen.queryByRole('button', { name: /reset zoom/i })).not.toBeInTheDocument();
  });

  it('lets the wheel keep scrolling the page through the diagram when the cursor arrives mid-scroll', async () => {
    render(<MermaidBlock source="graph TD; A-->B;" />);
    const diagram = await screen.findByTestId('mermaid-svg');
    const wrapper = diagram.parentElement!;

    // simulate an in-progress page scroll (wheel firing elsewhere) right
    // before the cursor happens to cross into the diagram's bounds
    fireEvent.wheel(window, { deltaY: 100 });
    fireEvent.mouseEnter(wrapper);
    fireEvent.wheel(wrapper, { deltaY: 100 });

    expect(diagram.style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(screen.queryByRole('button', { name: /reset zoom/i })).not.toBeInTheDocument();
  });

  it('zooms on wheel once the cursor rests on the diagram without a prior scroll, until it leaves', async () => {
    render(<MermaidBlock source="graph TD; A-->B;" />);
    const diagram = await screen.findByTestId('mermaid-svg');
    const wrapper = diagram.parentElement!;

    // let the module-level "last page wheel" timestamp from the previous
    // test's simulated scroll age out past the pass-through window
    await new Promise((resolve) => setTimeout(resolve, 250));

    function currentScale() {
      return Number(diagram.style.transform.match(/scale\(([\d.]+)\)/)?.[1]);
    }

    fireEvent.mouseEnter(wrapper);
    fireEvent.wheel(wrapper, { deltaY: -100 });
    expect(currentScale()).toBeCloseTo(1.15);

    fireEvent.mouseLeave(wrapper);
    fireEvent.mouseEnter(wrapper);
    // still no page-scroll in between, so it should keep zooming, not pass through
    fireEvent.wheel(wrapper, { deltaY: -100 });
    expect(currentScale()).toBeCloseTo(1.3);
  });
});
