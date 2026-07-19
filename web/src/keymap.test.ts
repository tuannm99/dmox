import { describe, it, expect, vi, afterEach } from 'vitest';
import { defaultKeymap, matches, mergeKeymap, fetchKeymapOverrides } from './keymap';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('matches', () => {
  it('matches a plain mod+key binding using ctrlKey on non-Mac', () => {
    const event = new KeyboardEvent('keydown', { key: '`', ctrlKey: true });
    expect(matches(event, defaultKeymap.terminal)).toBe(true);
  });

  it('does not match when the modifier is missing', () => {
    const event = new KeyboardEvent('keydown', { key: '`', ctrlKey: false });
    expect(matches(event, defaultKeymap.terminal)).toBe(false);
  });

  it('does not match when an unrelated key is pressed', () => {
    const event = new KeyboardEvent('keydown', { key: 'x', ctrlKey: true });
    expect(matches(event, defaultKeymap.terminal)).toBe(false);
  });

  it('requires shift when the binding specifies it', () => {
    const withoutShift = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: false });
    const withShift = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: true });
    expect(matches(withoutShift, defaultKeymap.search)).toBe(false);
    expect(matches(withShift, defaultKeymap.search)).toBe(true);
  });

  it('uses metaKey instead of ctrlKey on Mac', () => {
    vi.stubGlobal('navigator', { ...navigator, platform: 'MacIntel' });
    const event = new KeyboardEvent('keydown', { key: '`', metaKey: true });
    expect(matches(event, defaultKeymap.terminal)).toBe(true);
  });
});

describe('mergeKeymap', () => {
  it('overrides only the actions present in the override map', () => {
    const merged = mergeKeymap({ terminal: 'mod+j' });
    expect(merged.terminal).toBe('mod+j');
    expect(merged.search).toBe(defaultKeymap.search);
    expect(merged['ai-context']).toBe(defaultKeymap['ai-context']);
  });

  it('ignores unknown keys in the override map', () => {
    const merged = mergeKeymap({ bogus: 'mod+z' } as any);
    expect(merged).toEqual(defaultKeymap);
  });
});

describe('fetchKeymapOverrides', () => {
  it('returns the parsed JSON body on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ terminal: 'mod+j' }) }));
    await expect(fetchKeymapOverrides()).resolves.toEqual({ terminal: 'mod+j' });
  });

  it('returns {} when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(fetchKeymapOverrides()).resolves.toEqual({});
  });

  it('returns {} on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    await expect(fetchKeymapOverrides()).resolves.toEqual({});
  });
});
