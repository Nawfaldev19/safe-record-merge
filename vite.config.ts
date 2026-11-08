import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/web', emptyOutDir: true, sourcemap: true },
  server: {
    port: 5175,
    proxy: {
      '/graphql': 'http://localhost:4100',
      '/files': 'http://localhost:4100',
    },
  },
});
