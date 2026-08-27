import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    build: {
      outDir: 'dist',
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/data/**']
      },
      // Blueprint: React Dashboard (Vite) läuft auf :3000 (Windows-Host & Local-Dev)
      host: true,
      port: 3000,
      allowedHosts: true,
      proxy: {
        // Alpha Execution Core (Ubuntu Core, LAN: 192.168.178.50:8000 / Local: 127.0.0.1:8000)
        '/api': {
          target: process.env.ALPHA_CORE_PROXY || 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: true,
      port: 3000,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: process.env.ALPHA_CORE_PROXY || 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
  };
});
