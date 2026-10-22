import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import path from 'node:path';
import assert from 'node:assert/strict';

// Real modal code, with deferred disk reads to reproduce out-of-order completion.
const bundle = await build({
  stdin: { contents: `
    import { PublishBackupsModal } from './modals/PublishBackupsModal';
    import { PublishDirectoryModal } from './modals/PublishDirectoryModal';
    const pending = [];
    window.pending = pending;
    window.defer = (kind, args) => new Promise((resolve, reject) => pending.push({kind, args, resolve, reject}));
    window.openBackups = () => { window.modal = new PublishBackupsModal({}, '/blog'); window.modal.open(); };
    window.openDirectory = () => { window.modal = new PublishDirectoryModal({}, (...args) => window.defer('inspect', args)); window.modal.open(); };
  `, resolveDir: process.cwd() },
  bundle: true, platform: 'browser', format: 'esm', write: false,
  plugins: [{ name: 'publishing-ui-fixtures', setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.resolve('tests/fixtures/wechat-obsidian.ts') }));
    builder.onResolve({ filter: /utils\/(publishBackups|platforms)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('platforms')
      ? `export const getPublishBackupDirectory = () => '/blog/.easy-pub-backups';`
      : `export const listPublishBackups = (...args) => window.defer('list', args); export const readPublishBackup = (...args) => window.defer('read', args);` }));
  } }],
});
const browser = await chromium.launch({ executablePath: process.env.EASYPUB_CHROME_PATH, headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text, type: 'module' });
  await page.waitForFunction(() => !!window.openBackups);
  const button = name => page.getByRole('button', { name, exact: true });
  const entries = Array.from({ length: 21 }, (_, i) => ({ name: `${i}.bak`, path: `/blog/${i}.bak`, bytes: 100, savedAt: 1000 + i }));
  const settle = async (index, value, error) => {
    await page.evaluate(({ index, value, error }) => {
      const request = window.pending[index];
      if (error) request.reject(new Error(error)); else request.resolve(value);
    }, { index, value, error });
  };
  const preview = title => ({ title, content: '<img src=x onerror="window.injected=true">', source: '<script>bad</script>', pubId: 'old-id', hashMatches: false, metadataValid: false });
  await page.evaluate(() => window.openBackups());
  await settle(0, null, 'disk unavailable');
  await page.getByText('无法列出备份：disk unavailable', { exact: true }).waitFor();
  await button('刷新列表').click();
  await settle(1, entries);
  await button('下一页').waitFor();
  assert.equal(await button('查看原文与来源').count(), 20);
  assert.equal(await button('上一页').isDisabled(), true);
  await button('查看原文与来源').nth(0).click();
  await button('查看原文与来源').nth(1).click();
  await settle(3, preview('new selection'));
  await settle(2, preview('stale selection'));
  assert.equal(await page.getByRole('heading', { level: 3 }).innerText(), 'new selection');
  assert.equal(await page.getByRole('textbox').evaluate(el => el.readOnly), true);
  assert.equal(await page.getByRole('textbox').inputValue(), preview('').content);
  assert.equal(await page.evaluate(() => !!window.injected), false);
  assert.match(await page.getByRole('dialog').innerText(), /元数据无法解析/);
  await button('查看原文与来源').nth(0).click();
  await button('下一页').click();
  await settle(4, preview('previous page'));
  assert.equal(await button('查看原文与来源').count(), 1);
  assert.equal(await button('下一页').isDisabled(), true);
  assert.equal(await page.getByRole('textbox').count(), 0);
  await button('查看原文与来源').click();
  await page.evaluate(() => window.modal.close());
  await settle(5, preview('closed'));
  assert.equal(await page.evaluate(() => window.modal.contentEl.textContent), '');
  await page.evaluate(() => window.openBackups());
  await button('刷新列表').click();
  await settle(7, []);
  await settle(6, entries);
  assert.equal(await button('查看原文与来源').count(), 0);
  await page.getByText('暂无备份。覆盖已有 Hexo 稿件时才会生成备份。', { exact: true }).waitFor();
  await page.evaluate(() => { window.modal.close(); window.openDirectory(); });
  await button('开始检查').click();
  assert.equal(await button('开始检查').isDisabled(), true);
  assert.equal(await page.getByRole('combobox').isDisabled(), true);
  await settle(8, null, 'scan failed');
  await page.getByText('scan failed', { exact: true }).waitFor();
  assert.equal(await button('开始检查').isDisabled(), false);
  assert.equal(await page.getByRole('combobox').isDisabled(), false);
  await button('开始检查').click();
  await settle(9, { checked: 2, issues: [{ kind: 'invalid', paths: ['<img src=x onerror="window.injected=true">'], message: '坏元数据' }] });
  await page.getByText('坏元数据', { exact: true }).waitFor();
  assert.equal(await page.locator('li').innerText(), '<img src=x onerror="window.injected=true">');
  assert.equal(await page.locator('li img').count(), 0);
  await button('开始检查').click();
  await page.evaluate(() => window.modal.close());
  assert.equal(await page.evaluate(() => window.pending[10].args[1]()), true);
  await settle(10, { checked: 1, issues: [] });
  assert.equal(await page.evaluate(() => window.modal.contentEl.textContent), '');
  assert.deepEqual(errors, []);
  console.log('Publishing UI: pagination, retry, stale reads, cancellation and readonly text passed.');
} finally { await browser.close(); }
