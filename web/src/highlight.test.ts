import { describe, it, expect } from 'vitest';
import { highlightCode } from './highlight';

describe('highlightCode', () => {
  it('highlights Dockerfile syntax even though it is outside highlight.js/lib/common', async () => {
    const html = await highlightCode('FROM alpine', 'dockerfile');
    expect(html).not.toBeNull();
    expect(html).toContain('<span');
  });

  it('highlights Jenkinsfile (groovy) syntax even though it is outside highlight.js/lib/common', async () => {
    const html = await highlightCode('def x = 1', 'groovy');
    expect(html).not.toBeNull();
    expect(html).toContain('<span');
  });

  it('returns null for an unknown language', async () => {
    const html = await highlightCode('hello', 'nope');
    expect(html).toBeNull();
  });
});
