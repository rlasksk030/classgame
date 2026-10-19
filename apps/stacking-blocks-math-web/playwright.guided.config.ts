import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// Engine coverage only: physical Android/iPad/school tablets remain NOT_VERIFIED.
export default defineConfig({
  ...base,
  testMatch: '**/guided-building.spec.ts',
  projects: [{name: 'webkit-engine', use: {browserName: 'webkit', launchOptions: {}}}],
});
