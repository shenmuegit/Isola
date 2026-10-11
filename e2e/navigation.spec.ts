import { expect, test } from '@playwright/test';

test('one native titlebar shares installed entries with market, preserves failed update and replaces successful update', async ({ page }) => {
  const release = (id: string, name: string, title: string, version = '1.0.0', apiVersion = 1) => ({ id, manifest: { name, version, description: title, isola: { title, apiVersion, entry: 'dist/index.html' } }, entryUrl: `/empty-plugin-${id}` });
  const old = release('old', '@test/one', 'First');
  const latest = release('new', '@test/one', 'First', '1.0.1');
  const second = release('second', '@test/two', 'Second');
  const incompatible = release('bad', '@test/bad', 'Incompatible', '1.0.0', 2);
  let fail = true;
  let installationLoads = 0;
  await page.route('**/api/auth/get-session*', route => route.fulfill({ json: { user: { id: 'user', name: 'Menu user', email: 'menu@example.test' }, session: { id: 'session', userId: 'user', expiresAt: '2030-01-01T00:00:00Z' } } }));
  await page.route('**/api/market/releases', route => route.fulfill({ json: [latest, second, incompatible] }));
  await page.route('**/empty-plugin-*', route => route.fulfill({ body: '<p>Plugin content</p>', contentType: 'text/html' }));
  await page.route('**/api/installations', route => {
    if (route.request().method() === 'GET') { installationLoads++; return route.fulfill({ json: [old, second, incompatible] }); }
    return route.fulfill(fail ? { status: 503, json: { message: 'update failed' } } : { json: latest });
  });
  await page.goto('/?mode=app');
  await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '工作空间导航' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Incompatible', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'First', exact: true }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', old.entryUrl);
  await expect(page.locator('header')).toHaveCount(1);
  await page.getByRole('button', { name: '菜单', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: '工作空间导航' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: '菜单', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await page.getByRole('button', { name: 'Second', exact: true }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', second.entryUrl);
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await page.getByRole('button', { name: '返回市场' }).click();
  await page.getByRole('button', { name: '更新', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'update failed' })).toBeVisible();
  await page.getByRole('article', { name: 'First 1.0.0' }).getByRole('button', { name: '打开' }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', old.entryUrl);
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await page.getByRole('button', { name: '返回市场' }).click();
  fail = false;
  await page.getByRole('button', { name: '更新', exact: true }).click();
  await expect(page.getByRole('article', { name: 'First 1.0.1' })).toBeVisible();
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await page.getByRole('button', { name: 'First', exact: true }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', latest.entryUrl);
  expect(installationLoads).toBe(1);
  await page.setViewportSize({ width: 346, height: 597 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('installation loading prevents duplicate install and failed load can be retried', async ({ page }) => {
  const release = { id: 'loaded', manifest: { name: '@test/loading', version: '1.0.0', description: 'Loading', isola: { title: 'Loading', apiVersion: 1, entry: 'dist/index.html' } }, entryUrl: '/loading-plugin' };
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let attempts = 0;
  await page.route('**/api/auth/get-session*', route => route.fulfill({ json: { user: { id: 'user', name: 'User', email: 'user@example.test' }, session: { id: 'session', userId: 'user', expiresAt: '2030-01-01T00:00:00Z' } } }));
  await page.route('**/api/market/releases', route => route.fulfill({ json: [release] }));
  await page.route('**/api/installations', async route => {
    if (++attempts === 1) { await pending; await route.fulfill({ status: 503, json: { message: 'load failed' } }); }
    else await route.fulfill({ json: [release] });
  });
  await page.goto('/?mode=app');
  await expect(page.getByRole('button', { name: '安装', exact: true })).toBeDisabled({ timeout: 1000 });
  finish();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Loading', exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});

test('auth owner changes discard old menu entries and late installation loads', async ({ page }) => {
  let owner: string | null = 'first';
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let loads = 0;
  const release = (name: string) => ({ id: name, manifest: { name: `@test/${name}`, version: '1.0.0', description: name, isola: { title: name, apiVersion: 1, entry: 'dist/index.html' } }, entryUrl: `/${name}` });
  await page.route('**/api/auth/get-session*', route => route.fulfill({ json: owner ? { user: { id: owner, name: owner, email: `${owner}@example.test` }, session: { id: `session-${owner}`, userId: owner, expiresAt: '2030-01-01T00:00:00Z' } } : null }));
  await page.route('**/api/auth/sign-out', route => { owner = null; return route.fulfill({ json: { success: true } }); });
  await page.route('**/api/auth/sign-in/email', route => { owner = 'second'; return route.fulfill({ json: { redirect: false, token: 'fixture', user: { id: owner, name: owner, email: `${owner}@example.test` } } }); });
  await page.route('**/api/market/releases', route => route.fulfill({ json: [] }));
  await page.route('**/api/installations', async route => {
    const requestedOwner = owner!;
    loads++;
    if (requestedOwner === 'first') await pending;
    await route.fulfill({ json: [release(requestedOwner)] }).catch(() => {});
  });
  await page.goto('/?mode=app');
  await expect.poll(() => loads).toBe(1);
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByLabel('邮箱').fill('second@example.test');
  await page.getByLabel('密码').fill('fixture-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => loads).toBe(2);
  finish();
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await expect(page.getByRole('button', { name: 'second', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'first', exact: true })).toHaveCount(0);
});

test('selecting the already active plugin retains its current registered business menu', async ({ page }) => {
  const entry = '/@fs/' + process.cwd().replaceAll('\\', '/') + '/e2e/fixtures/plugin/dist/index.html?mode=menu';
  const release = { id: 'test-release', manifest: { name: '@test/current', version: '1.0.0', description: 'Current', isola: { title: 'Current', apiVersion: 1, entry: 'dist/index.html' } }, entryUrl: entry };
  await page.route('**/api/auth/get-session*', route => route.fulfill({ json: { user: { id: 'user', name: 'User', email: 'user@example.test' }, session: { id: 'session', userId: 'user', expiresAt: '2030-01-01T00:00:00Z' } } }));
  await page.route('**/api/market/releases', route => route.fulfill({ json: [] }));
  await page.route('**/api/installations', route => route.fulfill({ json: [release] }));
  await page.goto('/?mode=app');
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await page.getByRole('button', { name: 'Current', exact: true }).click();
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByRole('button', { name: '注册菜单', exact: true }).click();
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await expect(page.getByRole('button', { name: '执行菜单', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Current', exact: true }).click();
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await page.getByRole('button', { name: '执行菜单', exact: true }).click();
  await expect(plugin.locator('output')).toHaveText('执行:0');
});

test('late installation success from a previous auth owner cannot enter the next user menu', async ({ page }) => {
  let owner: string | null = 'first';
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let installing = false;
  const release = { id: 'private-first', manifest: { name: '@test/late-install', version: '1.0.0', description: 'First only', isola: { title: 'First only', apiVersion: 1, entry: 'dist/index.html' } }, entryUrl: '/private-first' };
  await page.route('**/api/auth/get-session*', route => route.fulfill({ json: owner ? { user: { id: owner, name: owner, email: `${owner}@example.test` }, session: { id: `session-${owner}`, userId: owner, expiresAt: '2030-01-01T00:00:00Z' } } : null }));
  await page.route('**/api/auth/sign-out', route => { owner = null; return route.fulfill({ json: { success: true } }); });
  await page.route('**/api/auth/sign-in/email', route => { owner = 'second'; return route.fulfill({ json: { redirect: false, token: 'fixture', user: { id: owner, name: owner, email: `${owner}@example.test` } } }); });
  await page.route('**/api/market/releases', route => route.fulfill({ json: [release] }));
  await page.route('**/api/installations', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    installing = true;
    await pending;
    return route.fulfill({ json: release });
  });
  await page.goto('/?mode=app');
  await page.getByRole('button', { name: '安装', exact: true }).click();
  await expect.poll(() => installing).toBe(true);
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByLabel('邮箱').fill('second@example.test');
  await page.getByLabel('密码').fill('fixture-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '安装', exact: true })).toBeEnabled();
  const completed = page.waitForResponse(response => response.url().endsWith('/api/installations') && response.request().method() === 'POST');
  finish();
  await completed;
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await expect(page.getByRole('button', { name: 'First only', exact: true })).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'First only 1.0.0' }).getByRole('button', { name: '打开', exact: true })).toHaveCount(0);
});
