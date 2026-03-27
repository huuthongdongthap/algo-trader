import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isCloudDeploy = process.env.CF_PAGES === '1';

export default defineConfig({
  plugins: [react()],
  base: isCloudDeploy ? '/' : '/dashboard/',
  build: {
    outDir: isCloudDeploy ? 'dist' : '../dist/dashboard',
    emptyOutDir: true,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
