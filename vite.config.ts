import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // COOP/COEP for SharedArrayBuffer (worker pools later); harmless for M0
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2048,
  },
});
