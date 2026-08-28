import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // No inline module-preload polyfill: every target (modern browsers, the
      // Capacitor WebViews, installed PWA) supports <link rel="modulepreload">
      // natively. Dropping it keeps the built index.html free of inline
      // scripts so a strict `script-src 'self'` CSP works with no hashes.
      modulePreload: { polyfill: false },
      // pdf/xlsx are genuinely large vendor libs, but they're lazy-loaded only
      // on the pages that use them — the warning about their size is expected.
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          // Split the big, rarely-changing libs out of the main bundle so a
          // client on the dashboard doesn't download the accountant-only
          // spreadsheet / PDF / charting code.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            xlsx: ['xlsx'],
            pdf: ['pdfjs-dist', 'jsqr'],
            datefns: ['date-fns'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
