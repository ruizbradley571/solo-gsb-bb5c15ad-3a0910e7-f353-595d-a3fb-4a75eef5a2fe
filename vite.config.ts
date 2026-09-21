import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./client', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url))] },
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./client/dist', import.meta.url)),
    emptyOutDir: true,
  },
});
