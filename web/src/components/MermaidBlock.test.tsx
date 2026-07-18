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
});
