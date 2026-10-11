import { expect, test } from '@playwright/test';

const entry = '/@fs/' + process.cwd().replaceAll('\\', '/') + '/e2e/fixtures/plugin/dist/index.html?mode=menu';
const host = '/?release=test-release&entry=' + encodeURIComponent(entry);

test('registered menu executes, replaces, ignores old cleanup and unregisters', async ({ page }) => {
  await page.goto(host);
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByRole('button', { name: '注册菜单', exact: true }).click();
  await page.getByRole('button', { name: '执行菜单', exact: true }).click();
  await expect(plugin.locator('output')).toHaveText('执行:0');
  await expect(page.getByRole('button', { name: '禁用菜单' })).toBeDisabled();
  await plugin.getByRole('button', { name: '替换注册' }).click();
  await plugin.getByRole('button', { name: '旧清理' }).click();
  await expect(page.getByRole('button', { name: '执行菜单', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '替换菜单' }).click();
  await expect(plugin.locator('output')).toHaveText('替换执行');
  await plugin.getByRole('button', { name: '注销菜单' }).click();
  await expect(page.getByRole('button', { name: '替换菜单' })).toHaveCount(0);
});

test('host native file picker preserves File content and same-file retry; cancellation does not invoke', async ({ page }) => {
  await page.goto(host);
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByRole('button', { name: '注册菜单', exact: true }).click();
  for (const count of [1, 2]) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入文件' }).click();
    await (await chooser).setFiles({ name: 'same.txt', mimeType: 'text/plain', buffer: Buffer.from('same-content') });
    await expect(plugin.locator('output')).toHaveText('same.txt:same-content');
    await expect(plugin.getByRole('status').filter({ hasText: '文件调用次数:' })).toHaveText(`文件调用次数: ${count}`);
  }
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入文件' }).click();
  await (await chooser).setFiles([]);
  await expect(plugin.locator('output')).toHaveText('same.txt:same-content');
  await expect(plugin.getByRole('status').filter({ hasText: '文件调用次数:' })).toHaveText('文件调用次数: 2');
});

test('sync and async errors reach host; stale errors and selections do not reach replacement', async ({ page }) => {
  await page.goto(host);
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByRole('button', { name: '注册菜单', exact: true }).click();
  await page.getByRole('button', { name: '同步错误' }).click();
  await expect(page.getByRole('alert')).toHaveText('同步失败');
  await page.getByRole('button', { name: '异步错误' }).click();
  await expect(page.getByRole('alert')).toHaveText('菜单失败');
  await page.getByRole('button', { name: '延迟错误' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入文件' }).click();
  const pending = await chooser;
  await plugin.getByRole('button', { name: '替换注册' }).click();
  await pending.setFiles({ name: 'stale.txt', mimeType: 'text/plain', buffer: Buffer.from('stale') });
  await page.waitForTimeout(450);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(plugin.locator('output')).toHaveText('');
});

test('disconnect and reload clear menus and reconnect uses the new channel', async ({ page }) => {
  await page.goto(host);
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByRole('button', { name: '注册菜单', exact: true }).click();
  await expect(page.getByRole('button', { name: '执行菜单', exact: true })).toBeVisible();
  await plugin.getByRole('button', { name: '断开通道' }).click();
  await expect(page.getByRole('button', { name: '执行菜单', exact: true })).toHaveCount(0);
  await plugin.getByRole('button', { name: '注册菜单', exact: true }).click();
  await page.getByRole('button', { name: '执行菜单', exact: true }).click();
  await expect(plugin.locator('output')).toHaveText('执行:0');
  await page.locator('iframe').evaluate(frame => { (frame as HTMLIFrameElement).src += '&reload=1'; });
  await expect(page.getByRole('button', { name: '执行菜单', exact: true })).toHaveCount(0);
  await plugin.getByRole('button', { name: '注册菜单', exact: true }).click();
  await page.getByRole('button', { name: '执行菜单', exact: true }).click();
  await expect(plugin.locator('output')).toHaveText('执行:0');
});

test('host rejects malformed menu entries and ignores forged window registrations', async ({ page }) => {
  await page.goto(host);
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByRole('button', { name: '注册菜单', exact: true }).click();
  await page.evaluate(() => window.postMessage({ type: 'menu-register', id: 'fake', items: [{ id: 'fake', label: '伪造菜单' }] }, '*'));
  await expect(page.getByRole('button', { name: '伪造菜单' })).toHaveCount(0);
  const frame = page.frames().find(frame => frame.parentFrame() === page.mainFrame())!;
  await frame.evaluate(async () => {
    const port = await new Promise<MessagePort>(resolve => {
      const handshake = (event: MessageEvent) => {
        if (event.source === parent && event.ports.length) { window.removeEventListener('message', handshake); resolve(event.ports[0]!); }
      };
      window.addEventListener('message', handshake);
      parent.postMessage({ type: 'isola:connect', apiVersion: 1 }, '*');
    });
    Object.assign(window, { menuPort: port });
    port.postMessage({ type: 'menu-register', id: 'valid', items: [{ id: 'safe', label: '原始菜单' }] });
  });
  await expect(page.getByRole('button', { name: '原始菜单' })).toBeVisible();
  for (const items of [null, [{}], [{ id: 'one', label: 'One', disabled: 'yes' }], [{ id: 'one', label: 'One', file: { accept: 1 } }], [{ id: 'same', label: 'One' }, { id: 'same', label: 'Two' }]]) {
    await frame.evaluate(items => (window as unknown as { menuPort: MessagePort }).menuPort.postMessage({ type: 'menu-register', id: 'bad', items }), items);
    await expect(page.getByRole('alert')).toHaveText('Invalid plugin menu entries');
    await expect(page.getByRole('button', { name: '原始菜单' })).toBeVisible();
  }
  await frame.evaluate(() => (window as unknown as { menuPort: MessagePort }).menuPort.postMessage({ type: 'menu-unregister', id: 'valid' }));
  await expect(page.getByRole('button', { name: '原始菜单' })).toHaveCount(0);
});

test('a picker opened before replacement cannot execute a new file action with the same item id', async ({ page }) => {
  await page.goto(host);
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByRole('button', { name: '注册菜单', exact: true }).click();
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入文件' }).click();
  const pending = await picker;
  await plugin.getByRole('button', { name: '替换文件注册' }).click();
  await expect(page.getByRole('button', { name: '替换文件', exact: true })).toBeVisible();
  await pending.setFiles({ name: 'old-selection.txt', mimeType: 'text/plain', buffer: Buffer.from('old') });
  await page.waitForTimeout(200);
  await expect(plugin.locator('output')).toHaveText('');
  const currentPicker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '替换文件', exact: true }).click();
  await (await currentPicker).setFiles({ name: 'new-selection.txt', mimeType: 'text/plain', buffer: Buffer.from('new') });
  await expect(plugin.locator('output')).toHaveText('新文件:new-selection.txt');
});
