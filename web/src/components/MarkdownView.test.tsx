import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"></svg>' }),
  },
}));

import { MarkdownView } from './MarkdownView';

function renderMarkdown(body: string, currentPath = 'local/services/auth/db-design.md') {
  return render(
    <MemoryRouter>
      <MarkdownView body={body} workspaceId="ws" currentPath={currentPath} />
    </MemoryRouter>
  );
}

describe('MarkdownView', () => {
  it('renders plain markdown and GFM tables', () => {
    renderMarkdown('# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('renders a mermaid fenced block via MermaidBlock', async () => {
    renderMarkdown('```mermaid\ngraph TD; A-->B;\n```');
    expect(await screen.findByTestId('mermaid-svg')).toBeInTheDocument();
  });

  it('renders raw HTML img tags (server-inlined PlantUML diagrams)', () => {
    renderMarkdown('<img alt="diagram" src="data:image/svg+xml;base64,AA==" />');
    expect(screen.getByAltText('diagram')).toBeInTheDocument();
  });

  it('renders an internal relative doc link as a client-side route Link, not a plain anchor', () => {
    renderMarkdown('[Data Ownership](../04-data-ownership.md)');
    const link = screen.getByRole('link', { name: 'Data Ownership' });
    expect(link).toHaveAttribute('href', '/w/ws/doc/local/services/04-data-ownership.md');
  });

  it('leaves an external link as a plain anchor pointing at the original URL', () => {
    renderMarkdown('[Example](https://example.com)');
    const link = screen.getByRole('link', { name: 'Example' });
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('leaves an in-page anchor link untouched', () => {
    renderMarkdown('[Jump](#overview)');
    const link = screen.getByRole('link', { name: 'Jump' });
    expect(link).toHaveAttribute('href', '#overview');
  });

  // Regression: the components map used to be rebuilt inline on every render,
  // giving react-markdown fresh component types and making React remount the
  // whole document. That re-ran MermaidBlock's async render, briefly emptying
  // the diagram — which collapses the scroll container's height and yanks the
  // reader back to the top on any re-render (e.g. the scroll-to-top button's
  // 300px threshold flipping mid-scroll).
  it('does not remount the document subtree when the parent re-renders', async () => {
    const mermaid = (await import('mermaid')).default;
    const { container, rerender } = renderMarkdown('```mermaid\ngraph TD; A-->B;\n```');
    await screen.findAllByTestId('mermaid-svg');
    const renderCalls = (mermaid.render as ReturnType<typeof vi.fn>).mock.calls.length;
    const diagramBefore = container.querySelector('.mermaid-diagram');

    rerender(
      <MemoryRouter>
        <MarkdownView body={'```mermaid\ngraph TD; A-->B;\n```'} workspaceId="ws" currentPath="local/services/auth/db-design.md" />
      </MemoryRouter>
    );

    expect((mermaid.render as ReturnType<typeof vi.fn>).mock.calls.length).toBe(renderCalls);
    // Same DOM node, still holding its rendered svg — a remount would have
    // replaced it with an empty one.
    expect(container.querySelector('.mermaid-diagram')).toBe(diagramBefore);
    expect(diagramBefore?.querySelector('svg')).not.toBeNull();
  });
});
