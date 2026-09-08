import { defineConfig } from 'vite';

// On GitHub Pages the site lives under /<repo-name>/, so built asset URLs need that prefix.
// Locally (npm run dev / start.bat) it stays at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' && process.env.GITHUB_ACTIONS ? '/gold-mining-sim/' : '/',
}));
