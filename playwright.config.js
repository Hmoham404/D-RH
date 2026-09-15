import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5176', channel: 'msedge', headless: true, locale: 'fr-FR' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'https://ui-test.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_ui_test' },
  },
});
