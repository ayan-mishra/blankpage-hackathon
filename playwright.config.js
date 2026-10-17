import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:8081', headless: true },
  webServer: {
    command: 'npm run serve -- --port 8081 --strictPort',
    url: 'http://127.0.0.1:8081',
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'https://somnium-test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key' },
  },
});
