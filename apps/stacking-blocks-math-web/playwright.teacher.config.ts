import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: '**/teacher-new-device.spec.ts',
  projects: [{ name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } }],
  reporter: [['list'], ['json', { outputFile: 'test-results/teacher-iphone-report.json' }]],
});
