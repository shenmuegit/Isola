import { resolve } from 'node:path';
import { Pool } from 'pg';
import { buildApp } from './app.ts';

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const app = await buildApp({ db, dataDir: resolve(process.env.DATA_DIR ?? './data'), origin: process.env.ORIGIN ?? 'http://localhost:3000' });
app.addHook('onClose', async () => { await db.end(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
