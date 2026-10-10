import { expect, test } from '@playwright/test';

const entry = '/@fs/' + process.cwd().replaceAll('\\', '/') + '/e2e/fixtures/plugin/dist/index.html';
const host = (mode = '') => '/?release=test-release&entry=' + encodeURIComponent(entry + '?mode=' + mode);

test('Columns wrap in declaration order, contain overflow and preserve editor nodes and drafts', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(host());
  const plugin = page.frameLocator('iframe[title="插件"]');
  const panes = plugin.getByRole('region');
  await expect(panes).toHaveCount(3);
  const wide = await panes.evaluateAll(elements => elements.map(e => { const b = e.getBoundingClientRect(); return { y: b.y, width: b.width }; }));
  expect(new Set(wide.map(b => b.y)).size).toBe(1);
  expect(wide[1]!.width).toBeCloseTo(wide[0]!.width * 2, 0);
  await plugin.getByLabel('内容').fill('未保存草稿');
  const editor = await plugin.getByLabel('内容').elementHandle();
  for (const width of [390, 260, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(plugin.getByLabel('内容')).toHaveValue('未保存草稿');
    expect(await editor!.evaluate(e => e === document.querySelector('textarea'))).toBe(true);
    const bounds = await plugin.locator('html').evaluate(e => ({ scroll: e.scrollWidth, client: e.clientWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client);
    if (width === 390) {
      const ys = await panes.evaluateAll(es => es.map(e => e.getBoundingClientRect().y));
      expect(ys[0]).toBeLessThan(ys[1]!);
      expect(ys[1]).toBeLessThan(ys[2]!);
    }
  }
  await plugin.getByRole('button', { name: '切换区域' }).click();
  await expect(panes).toHaveCount(4);
  await expect(plugin.getByLabel('内容')).toHaveValue('未保存草稿');
  expect(await editor!.evaluate(e => e === document.querySelector('textarea'))).toBe(true);
});

test('defaults follow rem size and nested columns follow their container', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto(host('default'));
  const plugin = page.frameLocator('iframe[title="插件"]');
  const pane = plugin.getByRole('region', { name: '默认一' });
  expect(await pane.evaluate(e => getComputedStyle(e).flexBasis)).toBe('320px');
  expect(await pane.evaluate(e => getComputedStyle(e.parentElement!).gap)).toBe('16px');
  await plugin.locator('html').evaluate(e => { e.style.fontSize = '20px'; });
  expect(await pane.evaluate(e => getComputedStyle(e).flexBasis)).toBe('400px');
  expect(await pane.evaluate(e => getComputedStyle(e.parentElement!).gap)).toBe('20px');
  await expect(plugin.getByRole('region', { name: '默认二' })).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(host('nested'));
  const one = await plugin.getByRole('region', { name: '内层一', exact: true }).boundingBox();
  const two = await plugin.getByRole('region', { name: '内层二', exact: true }).boundingBox();
  expect(two!.y).toBeGreaterThan(one!.y);
});

test('ListDetail keeps mounted state and moves focus into the visible pane', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(host('detail'));
  const plugin = page.frameLocator('iframe[title="插件"]');
  await expect(plugin.getByLabel('内容')).toBeHidden();
  await plugin.getByRole('button', { name: '选择笔记' }).click();
  await expect(plugin.getByRole('button', { name: '选择笔记' })).toBeHidden();
  await expect(plugin.getByLabel('内容')).toBeFocused();
  await plugin.getByLabel('内容').fill('保留');
  const editor = await plugin.getByLabel('内容').elementHandle();
  await plugin.getByRole('button', { name: '返回' }).click();
  await expect(plugin.getByRole('button', { name: '选择笔记' })).toBeFocused();
  await expect(plugin.getByLabel('内容')).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(plugin.getByLabel('内容')).toBeVisible();
  await expect(plugin.getByLabel('内容')).toHaveValue('保留');
  expect(await editor!.evaluate(e => e === document.querySelector('textarea'))).toBe(true);
  await expect(plugin.getByRole('button', { name: '返回' })).toBeHidden();
});

test('focused input and action remain reachable after the visible viewport height shrinks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(host('input'));
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByLabel('内容').fill('键盘草稿');
  await page.setViewportSize({ width: 390, height: 300 });
  await expect(plugin.getByLabel('内容')).toBeInViewport();
  await plugin.getByRole('button', { name: '保存' }).scrollIntoViewIfNeeded();
  await expect(plugin.getByRole('button', { name: '保存' })).toBeInViewport();
  await expect(plugin.getByLabel('内容')).toHaveValue('键盘草稿');
  const bounds = await page.locator('iframe').boundingBox();
  expect(bounds!.height).toBe(300);
});

test('ListDetail breakpoint follows its own container and current rem size', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(host('detail'));
  const plugin = page.frameLocator('iframe[title="插件"]');
  const layout = plugin.locator('.isola-list-detail');
  await layout.evaluate(e => { (e as HTMLElement).style.width = '800px'; });
  await expect(plugin.getByLabel('内容')).toBeVisible();
  await plugin.getByLabel('内容').focus();
  await plugin.locator('html').evaluate(e => { e.style.fontSize = '20px'; });
  await expect(plugin.getByLabel('内容')).toBeHidden();
  await expect(plugin.getByRole('button', { name: '选择笔记' })).toBeFocused();
  await plugin.locator('html').evaluate(e => { e.style.fontSize = '16px'; });
  await expect(plugin.getByLabel('内容')).toBeVisible();
  await expect(plugin.getByLabel('内容')).toBeEnabled();
  expect(await plugin.getByRole('region', { name: '详情', exact: true }).evaluate(e => (e as HTMLElement).inert)).toBe(false);
});

test('nested ListDetail selection only hides its own panes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(host('nested-detail'));
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByRole('button', { name: '选择内层笔记' }).click();
  await expect(plugin.getByLabel('内容')).toBeVisible();
  await expect(plugin.getByText('外层详情')).toBeHidden();
  await plugin.getByLabel('内容').fill('内层草稿');
  await plugin.getByRole('button', { name: '返回' }).click();
  await expect(plugin.getByRole('button', { name: '选择内层笔记' })).toBeVisible();
  await plugin.getByRole('button', { name: '选择内层笔记' }).click();
  await expect(plugin.getByLabel('内容')).toHaveValue('内层草稿');
});
