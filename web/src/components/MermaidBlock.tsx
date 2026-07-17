import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let initialized = false;

export function MermaidBlock({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      initialized = true;
    }
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (ref.current) ref.current.innerHTML = svg;
      })
      .catch((e: unknown) => setError(String(e)));
  }, [source]);

  if (error) {
    return <pre className="mermaid-error">Mermaid render failed: {error}</pre>;
  }
  return <div className="mermaid-diagram" data-testid="mermaid-svg" ref={ref} />;
}
