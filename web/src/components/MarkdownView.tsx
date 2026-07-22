import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Link } from 'react-router-dom';
import { MermaidBlock } from './MermaidBlock';
import { isInternalDocLink, resolveDocLink } from '../docLinks';

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeRaw];

// Everything below must keep a STABLE identity across renders. React compares
// element types by reference, so a `components` map rebuilt inline on each
// render hands react-markdown brand-new component types every time, and React
// unmounts + remounts the whole document subtree instead of updating it. That
// isn't just wasted work: remounting a MermaidBlock re-runs its async render,
// leaving the diagram empty for a frame, which collapses .content's
// scrollHeight by the diagram's full height and makes the browser clamp
// scrollTop — i.e. any re-render (e.g. the scroll-to-top button's threshold
// flipping at 300px) yanks the reader back to the top of a page containing a
// tall diagram.
const CodeRenderer: Components['code'] = ({ className, children, ...props }) => {
  if (/language-mermaid/.test(className ?? '')) {
    return <MermaidBlock source={String(children).replace(/\n$/, '')} />;
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
};

export function MarkdownView({ body, workspaceId, currentPath }: { body: string; workspaceId: string; currentPath: string }) {
  const components = useMemo<Components>(
    () => ({
      code: CodeRenderer,
      // Cross-doc links written in Markdown source (e.g. "../foo.md") are
      // plain relative hrefs with no knowledge of the app's client-side
      // routes. Left as native <a> tags, clicking one triggers a full
      // browser navigation — reloading the whole SPA and, with it, killing
      // any open Terminal WebSocket/shell. Resolve internal ones against
      // the current doc's path and route them through React Router
      // instead; genuine external links/anchors are left untouched.
      a({ href, children, ...props }) {
        if (href && isInternalDocLink(href)) {
          const targetPath = resolveDocLink(currentPath, href);
          return (
            <Link to={`/w/${workspaceId}/doc/${targetPath}`} {...props}>
              {children}
            </Link>
          );
        }
        return (
          <a href={href} {...props}>
            {children}
          </a>
        );
      },
    }),
    [workspaceId, currentPath]
  );

  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
      {body}
    </ReactMarkdown>
  );
}
