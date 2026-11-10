import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// La app se sirve bajo /josemaria-rag/ (nginx quita el prefijo al hacer proxy
// al backend, que sirve estos estáticos). Base relativa para que los assets
// funcionen con y sin prefijo.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8100',
    },
  },
});
