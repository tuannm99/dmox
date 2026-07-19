import { describe, it, expect } from 'vitest';
import { isInternalDocLink, resolveDocLink } from './docLinks';

describe('isInternalDocLink', () => {
  it('treats a plain relative path as internal', () => {
    expect(isInternalDocLink('../04-data-ownership.md')).toBe(true);
    expect(isInternalDocLink('./sibling.md')).toBe(true);
    expect(isInternalDocLink('sibling.md')).toBe(true);
  });

  it('rejects in-page anchors', () => {
    expect(isInternalDocLink('#some-heading')).toBe(false);
  });

  it('rejects absolute paths', () => {
    expect(isInternalDocLink('/w/ws/doc/local/foo.md')).toBe(false);
    expect(isInternalDocLink('//example.com/foo')).toBe(false);
  });

  it('rejects external URLs with a scheme', () => {
    expect(isInternalDocLink('https://example.com')).toBe(false);
    expect(isInternalDocLink('mailto:someone@example.com')).toBe(false);
  });

  it('rejects an empty href', () => {
    expect(isInternalDocLink('')).toBe(false);
  });
});

describe('resolveDocLink', () => {
  it('resolves a same-directory sibling link', () => {
    expect(resolveDocLink('local/services/auth/db-design.md', './api-design.md')).toBe(
      'local/services/auth/api-design.md'
    );
  });

  it('resolves a link with no leading ./ the same as one with it', () => {
    expect(resolveDocLink('local/services/auth/db-design.md', 'api-design.md')).toBe(
      'local/services/auth/api-design.md'
    );
  });

  it('resolves a ../ link up one directory', () => {
    expect(resolveDocLink('local/services/auth/db-design.md', '../04-data-ownership.md')).toBe(
      'local/services/04-data-ownership.md'
    );
  });

  it('resolves multiple ../ segments', () => {
    expect(resolveDocLink('local/services/auth/db-design.md', '../../README.md')).toBe('local/README.md');
  });

  it('strips a trailing fragment before resolving', () => {
    expect(resolveDocLink('local/services/auth/db-design.md', './api-design.md#overview')).toBe(
      'local/services/auth/api-design.md'
    );
  });
});
