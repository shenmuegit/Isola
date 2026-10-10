import { Buffer } from 'node:buffer';
import type { ViteDevServer } from 'vite';
import config from '../../../apps/client/vite.config.js';

export default {
  ...config,
  plugins: [{
    name: 'fixture-upload',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/plugins/test-release/api/json', (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ saved: true, authenticated: request.headers.cookie?.includes('host_session=secret') ?? false }));
      });
      server.middlewares.use('/api/plugins/test-release/api/upload', (request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(Buffer.from(chunk)));
        request.on('end', () => {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ text: Buffer.concat(chunks).toString('utf8'), contentType: request.headers['content-type'] }));
        });
      });
    },
  }],
};
