import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  server: { cors: true },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: '@isola/plugin/styles.css', replacement: fileURLToPath(new URL('../../packages/plugin/src/styles.css', import.meta.url)) },
      { find: '@isola/plugin/ui', replacement: fileURLToPath(new URL('../../packages/plugin/src/ui.tsx', import.meta.url)) },
      { find: '@isola/plugin', replacement: fileURLToPath(new URL('../../packages/plugin/src/index.ts', import.meta.url)) },
    ],
  },
});
