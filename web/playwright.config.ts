import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  projects: [
    { name: 'live', use: { baseURL: 'http://localhost:8080' } },
    { name: 'static', use: { baseURL: 'http://localhost:4173' } },
  ],
  retries: 0,
  timeout: 30_000,
});
