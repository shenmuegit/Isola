import { createServer } from 'node:http';
import { Pool } from 'pg';

const db = new Pool({ connectionString: process.env.DATABASE_URL });
await db.query('CREATE TABLE IF NOT EXISTS notes (user_id text PRIMARY KEY, body text NOT NULL)');
let streams = 0;
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://plugin');
  const user = req.headers['x-isola-user-id'];
  const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  try {
    if (url.pathname === '/health') return json({ name: process.env.ISOLA_PLUGIN_NAME, version: process.env.HEALTH_VERSION || process.env.ISOLA_PLUGIN_VERSION, apiVersion: 1 }, process.env.HEALTH_VERSION === 'unready' ? 503 : 200);
    if (url.pathname === '/events') {
      streams++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"ready":true}\n\n');
      const timer = setInterval(() => res.write(': keepalive\n\n'), 100);
      res.on('close', () => { clearInterval(timer); streams--; });
      return;
    }
    if (url.pathname === '/streams') return json({ streams });
    if (url.pathname === '/redirect') { res.writeHead(302, { location: 'http://postgres:5432/' }); return res.end(); }
    if (url.pathname === '/document') { res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'framework=forged; Path=/' }); return res.end('<script>parent.document.body.innerHTML="forged"</script>'); }
    if (url.pathname === '/empty') { res.writeHead(204); return res.end(); }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (url.pathname === '/echo' || url.pathname.startsWith('//')) return json({ path: req.url, headers: req.headers, body: body.toString('base64'), user });
    if (url.pathname === '/notes') {
      if (req.method === 'POST') await db.query('INSERT INTO notes VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET body = EXCLUDED.body', [user, body.toString()]);
      return json((await db.query('SELECT body FROM notes WHERE user_id = $1', [user])).rows);
    }
    json({ message: 'Not found' }, 404);
  } catch (error) { json({ message: error.message }, 500); }
}).listen(3000, '0.0.0.0');
