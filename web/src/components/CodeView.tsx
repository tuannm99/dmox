import { useEffect, useMemo, useRef, useState } from 'react';
import { highlightCode } from '../highlight';

function LineGutter({ count }: { count: number }) {
  const nums = useMemo(() => Array.from({ length: count }, (_, i) => i + 1), [count]);
  return (
    <div className="code-gutter" aria-hidden="true">
      {nums.map((n) => (
        <span key={n} className="code-line-no">
          {n}
        </span>
      ))}
    </div>
  );
}

export function CodeView({
  body,
  language = '',
  tooLargeToHighlight = false,
}: {
  body: string;
  language?: string;
  tooLargeToHighlight?: boolean;
}) {
  const lineCount = useMemo(() => (body.length ? body.split('\n').length : 0), [body]);
  const [html, setHtml] = useState<string | null>(null);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let alive = true;
    setHtml(null);
    if (tooLargeToHighlight || !language) return;
    highlightCode(body, language).then((h) => {
      if (alive) setHtml(h);
    });
    return () => {
      alive = false;
    };
  }, [body, language, tooLargeToHighlight]);

  const copy = () => navigator.clipboard?.writeText(body);

  return (
    <div className="code-view">
      <div className="code-toolbar">
        {language && <span className="code-lang">{language}</span>}
        <button type="button" className="code-copy" onClick={copy}>
          Copy
        </button>
      </div>
      {tooLargeToHighlight && (
        <p className="code-banner">Large file — syntax highlighting is off.</p>
      )}
      <div className="code-body">
        <LineGutter count={lineCount} />
        <pre className="code-pre">
          {html !== null ? (
            <code ref={codeRef} className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <code ref={codeRef}>{body}</code>
          )}
        </pre>
      </div>
    </div>
  );
}
