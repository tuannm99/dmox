// Resolves a relative link found inside a rendered Markdown doc body (e.g.
// "../04-data-ownership.md") against the currently-open doc's path (e.g.
// "local/03-architecture-detail-design/services/auth/db-design.md") into
// another doc's full path in the same scheme the app already uses for
// routing (source_id/relative/path.md).

const EXTERNAL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

// Whether href should be treated as an in-app doc link at all, as opposed
// to an in-page anchor, an absolute path, or a fully external URL — any of
// which should be left as a plain, unintercepted anchor.
export function isInternalDocLink(href: string): boolean {
  if (!href) return false;
  if (href.startsWith('#')) return false;
  if (href.startsWith('/') || href.startsWith('//')) return false;
  if (EXTERNAL_SCHEME_RE.test(href)) return false;
  return true;
}

export function resolveDocLink(currentPath: string, href: string): string {
  const [hrefPath] = href.split(/[?#]/, 1);
  const parts = currentPath.split('/');
  parts.pop(); // drop the current file's own name, keep its directory
  for (const segment of hrefPath.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}
