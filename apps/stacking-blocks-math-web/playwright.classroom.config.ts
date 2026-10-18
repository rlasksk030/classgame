import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// WebKit engine coverage is NOT physical iPad Safari verification.
export default defineConfig({
  ...base,
  testMatch: '**/classroom-input.spec.ts',
  projects: [{name: 'webkit-engine', use: {browserName: 'webkit', launchOptions: {}}}],
});
