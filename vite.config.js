import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', port: 8080 },
  build: { rollupOptions: { input: { main: 'index.html', app: 'app.html', study: 'study.html' } } },
});
