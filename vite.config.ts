import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

// Multi-entry build: every extension surface is its own HTML page, plus the
// MV3 service worker which must keep a stable filename for manifest.json.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    sourcemap: false,
    rollupOptions: {
      input: {
        dashboard: resolve(__dirname, 'dashboard.html'),
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        popup: resolve(__dirname, 'popup.html'),
        newtab: resolve(__dirname, 'newtab.html'),
        bar: resolve(__dirname, 'bar.html'), // V2.1 Tabspace Bar website iframe (added by Agent 3A)
        background: resolve(__dirname, 'src/extension/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        // Group shared vendor code instead of ~15 tiny per-icon chunks (fewer requests on New Tab / dashboard load).
        manualChunks(id) {
          if (id.includes('node_modules/lucide-react')) return 'icons';
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
});
