import { expect, test } from '@playwright/test';

const entry = '/@fs/' + process.cwd().replaceAll('\\', '/') + '/e2e/fixtures/plugin/dist/index.html?mode=bridge';
const host = '/?release=test-release&entry=' + encodeURIComponent(entry);

test('File body survives MessageChannel and requests belong to the actual iframe release', async ({ page }) => {
  await page.goto(host);
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByRole('button', { name: '上传文件' }).click();
  await expect(plugin.locator('output')).toHaveText(JSON.stringify({ text: '文件内容\0 unchanged', contentType: 'text/plain' }));
});

test('JSON, empty responses, HTTP errors and SSE reach the plugin', async ({ page }) => {
  await page.route('**/api/plugins/test-release/api/*', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/json')) {
      expect(route.request().postDataJSON()).toEqual({ text: 'hello' });
      return route.fulfill({ json: { saved: true } });
    }
    if (path.endsWith('/empty')) return route.fulfill({ status: 204 });
    if (path.endsWith('/failure')) return route.fulfill({ status: 403, body: 'Denied' });
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"text":"event"}\n\n' });
  });
  await page.goto(host);
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByRole('button', { name: 'JSON 请求' }).click();
  await expect(plugin.locator('output')).toHaveText('{"saved":true}');
  await plugin.getByRole('button', { name: '空响应' }).click();
  await expect(plugin.locator('output')).toHaveText('undefined');
  await plugin.getByRole('button', { name: '错误响应' }).click();
  await expect(plugin.locator('output')).toContainText('403');
  await plugin.getByRole('button', { name: '订阅' }).click();
  await expect(plugin.locator('output')).toHaveText('{"text":"event"}');
});

test('host ignores connect messages from windows other than its plugin iframe', async ({ page }) => {
  await page.goto(host);
  const accepted = await page.evaluate(async () => {
    const frame = document.createElement('iframe');
    frame.srcdoc = `<script>parent.postMessage({type:'isola:connect',apiVersion:1},'*');addEventListener('message',e=>{if(e.ports.length)parent.postMessage('unexpected-port','*')});<\/script>`;
    document.body.append(frame);
    return new Promise<boolean>(resolve => {
      let got = false;
      const listener = (event: MessageEvent) => { if (event.data === 'unexpected-port') got = true; };
      window.addEventListener('message', listener);
      setTimeout(() => { window.removeEventListener('message', listener); frame.remove(); resolve(got); }, 300);
    });
  });
  expect(accepted).toBe(false);
});

test('connecting during React mount remains usable after the iframe load event', async ({ page }) => {
  await page.route('**/delayed-image', async route => {
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />' });
  });
  await page.route('**/api/plugins/test-release/api/json', route => route.fulfill({ json: { saved: true } }));
  await page.goto('/?release=test-release&entry=' + encodeURIComponent(entry.replace('mode=bridge', 'mode=auto')));
  const plugin = page.frameLocator('iframe[title="插件"]');
  await expect(plugin.locator('output')).toHaveText('已连接');
  await plugin.getByRole('button', { name: '自动连接请求' }).click();
  await expect(plugin.locator('output')).toHaveText('{"saved":true}');
});

test('request timeout is explicit and never resends the business request', async ({ page }) => {
  await page.clock.install();
  let attempts = 0;
  await page.route('**/api/plugins/test-release/api/slow', () => { attempts++; });
  await page.goto(host);
  const requested = page.waitForRequest('**/api/plugins/test-release/api/slow');
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByRole('button', { name: '超时请求' }).click();
  await requested;
  await page.clock.fastForward(30_001);
  await expect(plugin.locator('output')).toContainText('timed out');
  expect(attempts).toBe(1);
});

test('connection timeout ignores a handshake sent by a sibling window', async ({ page }) => {
  await page.route('**/no-host', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="UTF-8"><iframe title="Plugin fixture" sandbox="allow-scripts" src="${entry}"></iframe>` }));
  await page.goto('/no-host');
  await page.evaluate(() => new Promise<void>(resolve => {
    const sibling = document.createElement('iframe');
    sibling.srcdoc = `<script>addEventListener('message',()=>{const c=new MessageChannel();parent.frames[0].postMessage({type:'isola:connect',apiVersion:1},'*',[c.port2]);c.port1.onmessage=e=>c.port1.postMessage({type:'result',id:e.data.id,data:'forged'});parent.postMessage('spoof-sent','*')});<\/script>`;
    sibling.onload = () => resolve();
    document.body.append(sibling);
  }));
  await page.clock.install();
  const plugin = page.frameLocator('iframe[title="Plugin fixture"]');
  await plugin.getByRole('button', { name: 'JSON 请求' }).click();
  await page.evaluate(() => new Promise<void>(resolve => {
    const ready = (event: MessageEvent) => { if (event.data === 'spoof-sent') { window.removeEventListener('message', ready); resolve(); } };
    window.addEventListener('message', ready);
    window.frames[1]!.postMessage('spoof', '*');
  }));
  await page.clock.fastForward(30_001);
  await expect(plugin.locator('output')).toContainText('connection timed out');
});

test('forged release ids and escaping paths cannot change request ownership or expose host credentials', async ({ page, context }) => {
  await context.addCookies([{ name: 'host_session', value: 'secret', url: 'http://127.0.0.1:4173', httpOnly: true }]);
  const urls: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) urls.push(path);
  });
  await page.goto(host);
  await page.frameLocator('iframe[title="插件"]').getByRole('button', { name: 'JSON 请求' }).waitFor();
  const frame = page.frames().find(frame => frame.parentFrame() === page.mainFrame())!;
  const results = await frame.evaluate(async () => {
    let canReadHost = false;
    try { canReadHost = Boolean(window.parent.document); } catch {}
    const port = await new Promise<MessagePort>(resolve => {
      const handshake = (event: MessageEvent) => {
        if (event.source === parent && event.ports.length) { window.removeEventListener('message', handshake); resolve(event.ports[0]!); }
      };
      window.addEventListener('message', handshake);
      parent.postMessage({ type: 'isola:connect', apiVersion: 1 }, '*');
    });
    const replies: { type: string; data?: unknown; message?: string }[] = [];
    for (const path of ['/json', '/../../session', 'https://example.com/private', '/%2e%2e/%2e%2e/session', '/%2f..%2fsession']) {
      replies.push(await new Promise(resolve => {
        port.onmessage = event => resolve(event.data);
        port.postMessage({ type: 'request', id: path, path, releaseId: 'other-release' });
      }));
    }
    port.close();
    return { canReadHost, replies };
  });
  expect(results.canReadHost).toBe(false);
  expect(results.replies[0]).toMatchObject({ type: 'result', data: { saved: true, authenticated: true } });
  expect(results.replies.slice(1).map(reply => reply.type)).toEqual(['error', 'error', 'error', 'error']);
  expect(urls).toEqual(['/api/plugins/test-release/api/json']);
});

test('leaving the plugin rejects a pending connection immediately', async ({ page }) => {
  await page.route('**/no-host', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="UTF-8"><iframe title="Plugin fixture" sandbox="allow-scripts" src="${entry}"></iframe>` }));
  await page.goto('/no-host');
  const plugin = page.frameLocator('iframe[title="Plugin fixture"]');
  await plugin.getByRole('button', { name: 'JSON 请求' }).click();
  await plugin.locator('output').evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(plugin.locator('output')).toContainText('connection closed');
});

test('leaving the plugin rejects pending business requests', async ({ page }) => {
  await page.route('**/api/plugins/test-release/api/slow', () => {});
  await page.goto(host);
  const requested = page.waitForRequest('**/api/plugins/test-release/api/slow');
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByRole('button', { name: '超时请求' }).click();
  await requested;
  await plugin.locator('output').evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(plugin.locator('output')).toContainText('connection closed');
});

test('actual plugin departure aborts the host fetch before the next iframe load', async ({ page }) => {
  let aborted = false;
  page.on('requestfailed', request => { if (new URL(request.url()).pathname.endsWith('/api/slow')) aborted = true; });
  await page.route('**/api/plugins/test-release/api/slow', () => {});
  await page.route('**/departure-pending-image', () => {});
  await page.route('**/departing', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="UTF-8"><p>Departing fixture</p><img src="/departure-pending-image" alt="loading">' }));
  await page.goto(host);
  const requested = page.waitForRequest('**/api/plugins/test-release/api/slow');
  await page.frameLocator('iframe[title="插件"]').getByRole('button', { name: '超时请求' }).click();
  await requested;
  await page.locator('iframe[title="插件"]').evaluate(frame => {
    frame.addEventListener('load', () => { frame.dataset.departureLoaded = 'true'; });
    (frame as HTMLIFrameElement).src = '/departing';
  });
  await expect(page.frameLocator('iframe[title="插件"]').getByText('Departing fixture')).toBeVisible();
  await expect.poll(() => aborted, { timeout: 5000 }).toBe(true);
  await expect(page.locator('iframe[title="插件"]')).not.toHaveAttribute('data-departure-loaded', 'true');
});

test('late close and disconnect messages from an old channel leave the replacement usable', async ({ page }) => {
  await page.addInitScript(() => {
    const ports: MessagePort[] = [];
    Object.assign(window, { observedPorts: ports });
    window.MessageChannel = class extends MessageChannel { constructor() { super(); ports.push(this.port1); } };
  });
  await page.route('**/api/plugins/test-release/api/json', route => route.fulfill({ json: { saved: true } }));
  await page.goto(host);
  await page.frameLocator('iframe[title="插件"]').getByRole('button', { name: 'JSON 请求' }).waitFor();
  const frame = page.frames().find(frame => frame.parentFrame() === page.mainFrame())!;
  await frame.evaluate(async () => {
    for (let i = 0; i < 2; i++) {
      const port = await new Promise<MessagePort>(resolve => {
        const handshake = (event: MessageEvent) => {
          if (event.source === parent && event.ports.length) { window.removeEventListener('message', handshake); resolve(event.ports[0]!); }
        };
        window.addEventListener('message', handshake);
        parent.postMessage({ type: 'isola:connect', apiVersion: 1 }, '*');
      });
      Object.assign(window, { replacementPort: port });
    }
  });
  await page.evaluate(() => {
    const oldPort = (window as unknown as { observedPorts: MessagePort[] }).observedPorts.at(-2)!;
    oldPort.dispatchEvent(new Event('close'));
    oldPort.dispatchEvent(new MessageEvent('message', { data: { type: 'disconnect' } }));
  });
  const result = await frame.evaluate(() => new Promise<{ type: string; data?: unknown }>(resolve => {
    const port = (window as unknown as { replacementPort: MessagePort }).replacementPort;
    port.onmessage = event => resolve(event.data);
    port.postMessage({ type: 'request', id: 'current', path: '/json' });
    setTimeout(() => resolve({ type: 'missing' }), 15_000);
  }));
  expect(result, JSON.stringify(result)).toMatchObject({ type: 'result', data: { saved: true } });
});
