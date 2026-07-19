export type PanelKind = 'terminal' | 'search' | 'ai-context';
export type Keymap = Record<PanelKind, string>;

export const defaultKeymap: Keymap = {
  terminal: 'mod+`',
  search: 'mod+shift+f',
  'ai-context': 'mod+shift+a',
};

export function matches(event: KeyboardEvent, binding: string): boolean {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform ?? '');

  const parts = binding.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const wantShift = parts.includes('shift');
  const wantMod = parts.includes('mod');

  const modPressed = isMac ? event.metaKey : event.ctrlKey;
  const otherModPressed = isMac ? event.ctrlKey : event.metaKey;

  if (wantMod !== modPressed) return false;
  if (otherModPressed) return false;
  if (wantShift !== event.shiftKey) return false;

  return event.key.toLowerCase() === key;
}

export function mergeKeymap(overrides: Partial<Record<string, string>>): Keymap {
  const merged = { ...defaultKeymap };
  for (const action of Object.keys(defaultKeymap) as PanelKind[]) {
    const override = overrides[action];
    if (typeof override === 'string') merged[action] = override;
  }
  return merged;
}

export async function fetchKeymapOverrides(): Promise<Partial<Record<string, string>>> {
  try {
    const res = await fetch('/api/keymap');
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}
