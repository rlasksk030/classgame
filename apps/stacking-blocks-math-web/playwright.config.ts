import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testIgnore: ['**/redesign*.spec.ts'],
  reporter: [['list'],['json',{outputFile:'test-results/live-report.json'}],['html',{open:'never'}]], fullyParallel: false, timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1366, height: 768 }, launchOptions: { args: ['--enable-unsafe-swiftshader'] }, trace: 'retain-on-failure', screenshot:'only-on-failure' },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false, env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-public-key' } },
});
