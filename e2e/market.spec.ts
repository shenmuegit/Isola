import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { manifest, npmPackage } from '../apps/server/test/fixtures.js';

const origin = process.env.ISOLA_E2E_ORIGIN ?? 'http://127.0.0.1:3000';
const email = 'market-publisher@example.test';
const password = 'market-password-123';

test('real session, package publishing, installation and persistent notes', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const signup = await request.post(`${origin}/api/auth/sign-up/email`, { headers: { origin }, data: { email, password, name: 'Publisher' } });
  expect([200, 422]).toContain(signup.status());
  await page.goto(origin);
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
  await page.goto(`${origin}/?release=forged&entry=${encodeURIComponent('https://outside.invalid/plugin.html')}`);
  await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByLabel('插件包').setInputFiles({ name: 'notes.tgz', mimeType: 'application/octet-stream', buffer: await readFile('examples/notes/isola-example-notes-0.1.0.tgz') });
  const published = page.waitForResponse(response => response.url().endsWith('/api/market/releases') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '发布', exact: true }).click();
  const result = await published;
  expect([201, 409]).toContain(result.status());
  if (result.status() === 409) await expect(page.getByRole('alert')).toContainText('already published');
  const notes = page.getByRole('article', { name: '笔记 0.1.0' });
  await expect(notes).toBeVisible();
  if (await notes.getByRole('button', { name: '安装', exact: true }).count()) await notes.getByRole('button', { name: '安装', exact: true }).click();
  await notes.getByRole('button', { name: '打开', exact: true }).click();
  const plugin = page.frameLocator('iframe[title="插件"]');
  const title = `验收记录 ${info.project.name} ${Date.now()}`;
  await plugin.getByRole('button', { name: '新建', exact: true }).click();
  await plugin.getByLabel('标题', { exact: true }).fill(title);
  await plugin.getByLabel('内容', { exact: true }).fill('市场安装后保存的内容');
  await plugin.getByRole('button', { name: '保存', exact: true }).click();
  await expect(plugin.getByRole('status')).toHaveText('已保存');
  await page.reload();
  await notes.getByRole('button', { name: '打开', exact: true }).click();
  await plugin.getByRole('button', { name: title, exact: true }).click();
  await expect(plugin.getByLabel('内容', { exact: true })).toHaveValue('市场安装后保存的内容');
  await page.getByRole('button', { name: '返回市场' }).click();
  await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByLabel('邮箱')).toBeVisible();
});

test('frontend composition uses the same package contract and real failed install has no open action', async ({ page }, info) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const email = `${info.project.name}-${Date.now()}@example.test`;
  await page.goto(origin);
  await page.getByRole('button', { name: '创建账号' }).click();
  await page.getByLabel('姓名').fill('Tester');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
  const name = `@isola-test/composition-${info.project.name}-${Date.now()}`;
  const title = `组合布局 ${info.project.name}`;
  // Use the actual built public-SDK fixture, rather than a replacement UI.
  const { archiveEntries } = await import('../apps/server/test/fixtures.js');
  const { readdir } = await import('node:fs/promises');
  const assets = await readdir('e2e/fixtures/plugin/dist/assets');
  const archive = archiveEntries([
    { path: 'package/package.json', body: JSON.stringify({ ...manifest, name, isola: { ...manifest.isola, title } }) },
    { path: 'package/dist/index.html', body: await readFile('e2e/fixtures/plugin/dist/index.html', 'utf8') },
    ...await Promise.all(assets.map(async file => ({ path: `package/dist/assets/${file}`, body: await readFile(`e2e/fixtures/plugin/dist/assets/${file}`, 'utf8') }))),
  ]);
  await page.getByLabel('插件包').setInputFiles({ name: 'composition.tgz', mimeType: 'application/octet-stream', buffer: archive });
  await page.getByRole('button', { name: '发布', exact: true }).click();
  const composition = page.getByRole('article', { name: `${title} 1.0.0` });
  await composition.getByRole('button', { name: '安装', exact: true }).click();
  await composition.getByRole('button', { name: '打开', exact: true }).click();
  await expect(page.frameLocator('iframe[title="插件"]').getByRole('region', { name: '编辑', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回市场' }).click();
  await page.getByLabel('插件包').setInputFiles({ name: 'failure.tgz', mimeType: 'application/octet-stream', buffer: await npmPackage({ ...manifest, name: `${name}-failure`, isola: { ...manifest.isola, title: `启动失败 ${info.project.name}`, server: { image: 'invalid.invalid/missing:image' } } }) });
  await page.getByRole('button', { name: '发布', exact: true }).click();
  const failure = page.getByRole('article', { name: `启动失败 ${info.project.name} 1.0.0` });
  await failure.getByRole('button', { name: '安装', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Plugin backend could not start');
  await expect(failure.getByRole('button', { name: '打开', exact: true })).toHaveCount(0);
  const broken = archiveEntries([
    { path: 'package/package.json', body: JSON.stringify({ ...manifest, name: `${name}-broken`, isola: { ...manifest.isola, title: `插件错误 ${info.project.name}` } }) },
    { path: 'package/dist/index.html', body: '<h1>插件错误</h1><script>throw new Error("plugin failure")</script>' },
  ]);
  await page.getByLabel('插件包').setInputFiles({ name: 'broken.tgz', mimeType: 'application/octet-stream', buffer: broken });
  await page.getByRole('button', { name: '发布', exact: true }).click();
  const brokenRelease = page.getByRole('article', { name: `插件错误 ${info.project.name} 1.0.0` });
  await brokenRelease.getByRole('button', { name: '安装', exact: true }).click();
  const crashed = page.waitForEvent('pageerror', error => error.message === 'plugin failure');
  await brokenRelease.getByRole('button', { name: '打开', exact: true }).click();
  await crashed;
  await page.getByRole('button', { name: '返回市场' }).click();
  await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
});
