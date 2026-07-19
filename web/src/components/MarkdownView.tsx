import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Link } from 'react-router-dom';
import { MermaidBlock } from './MermaidBlock';
import { isInternalDocLink, resolveDocLink } from '../docLinks';

export function MarkdownView({ body, workspaceId, currentPath }: { body: string; workspaceId: string; currentPath: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        code({ className, children, ...props }) {
          if (/language-mermaid/.test(className ?? '')) {
            return <MermaidBlock source={String(children).replace(/\n$/, '')} />;
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
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
      }}
    >
      {body}
    </ReactMarkdown>
  );
}
