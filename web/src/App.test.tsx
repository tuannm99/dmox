import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
  });

  it('renders the workspace picker with a fallback message when no workspaces exist', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText(/no workspaces configured/i)).toBeInTheDocument());
  });
});
