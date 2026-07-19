import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { matches } from '../keymap';

export function TerminalPanel({ workspaceId, toggleBinding }: { workspaceId: string; toggleBinding?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Read via ref, not a dependency: if the keymap override arrives (async
  // fetch in WorkspaceLayout) after the terminal is already open, the effect
  // below must NOT re-run — that would close this WebSocket and kill the
  // shell, exactly the bug this component exists to fix.
  const bindingRef = useRef(toggleBinding);
  bindingRef.current = toggleBinding;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      // Shell prompts (starship, oh-my-posh, powerlevel10k, ...) commonly
      // render icons/powerline glyphs that only exist in a "Nerd Font"
      // patched typeface. Listing common ones lets the browser pick up
      // whichever the user already has installed for their real terminal;
      // falls back to plain monospace (glyphs show as tofu boxes) if none
      // are present locally — there's no bundled font shipped for this.
      fontFamily:
        '"MesloLGS NF", "FiraCode Nerd Font", "JetBrainsMono Nerd Font", ' +
        '"Hack Nerd Font", "CaskaydiaCove Nerd Font", "Symbols Nerd Font", ' +
        'ui-monospace, monospace',
      fontSize: 13,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    term.attachCustomKeyEventHandler((event) => {
      const binding = bindingRef.current;
      // Returning false stops xterm from forwarding this keystroke to the
      // shell (so it doesn't also type e.g. a stray backtick) when it's the
      // configured toggle shortcut; everything else is forwarded normally.
      return binding ? !matches(event, binding) : true;
    });

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
