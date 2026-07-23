import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CodeView } from './CodeView';

describe('CodeView', () => {
  it('renders one gutter number per line', () => {
    const { container } = render(<CodeView body={'a\nb\nc'} language="go" />);
    expect(container.querySelectorAll('.code-line-no')).toHaveLength(3);
  });

  it('shows a banner and skips highlighting for oversized files', () => {
    const { container, getByText } = render(
      <CodeView body={'x'} language="go" tooLargeToHighlight />
    );
    expect(getByText(/highlight/i)).toBeInTheDocument();
    // plaintext: no hljs markup
    expect(container.querySelector('.hljs')).toBeNull();
  });

  it('does not remount its <pre> when the parent re-renders', () => {
    const { container, rerender } = render(<CodeView body={'a\nb'} language="go" />);
    const first = container.querySelector('pre');
    rerender(<CodeView body={'a\nb'} language="go" />);
    expect(container.querySelector('pre')).toBe(first);
  });
});
