import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"></svg>' }),
  },
}));

import { MarkdownView } from './MarkdownView';

describe('MarkdownView', () => {
  it('renders plain markdown and GFM tables', () => {
    render(<MarkdownView body={'# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |'} />);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('renders a mermaid fenced block via MermaidBlock', async () => {
    render(<MarkdownView body={'```mermaid\ngraph TD; A-->B;\n```'} />);
    expect(await screen.findByTestId('mermaid-svg')).toBeInTheDocument();
  });

  it('renders raw HTML img tags (server-inlined PlantUML diagrams)', () => {
    render(<MarkdownView body={'<img alt="diagram" src="data:image/svg+xml;base64,AA==" />'} />);
    expect(screen.getByAltText('diagram')).toBeInTheDocument();
  });
});
