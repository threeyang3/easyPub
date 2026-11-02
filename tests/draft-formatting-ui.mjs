import assert from 'node:assert/strict';

export async function runDraftFormattingUi(page) {
  const original = await page.evaluate(() => window.fixture.read());
  const sample = '---\npub_id: local-id\nsource_file: "[[source]]"\n---\n## 保留标题\n\n正文甲\n正文乙\n\n- 列表不缩进\n\n```ts\n  keep();\n```\n';
  const open = () => page.getByRole('button', {name: '基础排版', exact: true}).click();
  const dialog = page.getByRole('dialog');
  await page.evaluate(async text => { window.fixture.replace(text); await window.fixture.view.refresh(); }, sample);
  const backupCount = await page.evaluate(() => window.fixture.formattingBackups().length);
  await open();
  assert.match(await dialog.innerText(), /调整 2 个段落首行，增加 1 处段落空行/);
  assert.match(await dialog.getByLabel('基础排版差异').innerText(), /□□正文甲/);
  await dialog.getByRole('button', {name: '取消', exact: true}).click();
  assert.equal(await page.evaluate(() => window.fixture.read()), sample);
  assert.equal(await page.evaluate(() => window.fixture.formattingBackups().length), backupCount);
  await open();
  await dialog.getByLabel('段落之间加空行', {exact: true}).uncheck();
  assert.match(await dialog.innerText(), /调整 1 个段落首行，增加 0 处段落空行/);
  await dialog.getByLabel('段落之间加空行', {exact: true}).check();
  await dialog.getByRole('button', {name: '应用基础排版', exact: true}).click();
  await dialog.waitFor({state: 'hidden'});
  const formatted = await page.evaluate(() => window.fixture.read());
  assert.equal(formatted, sample.replace('正文甲\n正文乙', '　　正文甲\n\n　　正文乙'));
  assert.equal(await page.evaluate(() => window.fixture.formattingBackups().length), backupCount + 1);
  await open();
  assert.equal(await dialog.getByRole('button', {name: '应用基础排版', exact: true}).isDisabled(), true);
  await dialog.getByRole('button', {name: '取消', exact: true}).click();
  await page.evaluate(async text => { window.fixture.replace(text); await window.fixture.view.refresh(); }, sample);
  await open();
  await page.evaluate(() => window.fixture.replace(window.fixture.read() + '\n外部编辑'));
  await dialog.getByRole('button', {name: '应用基础排版', exact: true}).click();
  await dialog.getByRole('status').filter({hasText: '已变化'}).waitFor();
  assert.match(await page.evaluate(() => window.fixture.read()), /外部编辑/);
  assert.equal(await page.evaluate(() => window.fixture.formattingBackups().length), backupCount + 1);
  await dialog.getByRole('button', {name: '取消', exact: true}).click();
  await page.evaluate(async text => { window.fixture.replace(text); await window.fixture.view.refresh(); }, original);
  console.log('Basic formatting browser: preview, selected actions, cancel, fullwidth spaces, structure preservation, backups, idempotence and stale guards passed.');
}
