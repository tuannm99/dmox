import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export function TerminalView({ workspaceId }: { workspaceId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, monospace',
      fontSize: 13,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/workspaces/${workspaceId}/terminal/ws`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }));
    };
    ws.onmessage = (ev) => {
      const data = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : ev.data;
      term.write(typeof data === 'string' ? data : new TextDecoder().decode(data));
    };
    ws.onclose = () => {
      term.write('\r\n\x1b[31m[connection closed]\x1b[0m\r\n');
    };
    ws.onerror = () => {
      term.write('\r\n\x1b[31m[terminal connection error]\x1b[0m\r\n');
    };

    const dataListener = term.onData((chunk) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    });

    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }));
      }
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      dataListener.dispose();
      ws.close();
      term.dispose();
    };
  }, [workspaceId]);

  return <div className="terminal-view" ref={containerRef} />;
}
