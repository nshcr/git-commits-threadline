import { resolve } from 'path';
import { defineConfig } from 'vite';

// BASE_PATH controls the URL base for deployment.
// Example: BASE_PATH=/git-commits-threadline/ pnpm run build
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        graph: resolve(__dirname, 'graph.html'),
      },
    },
  },
});
