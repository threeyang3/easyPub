import assert from 'node:assert/strict';

// Runs against the real layout modal, workbench and renderer with a deferred AI transport.
export async function runLayoutUi(page) {
  await page.evaluate(() => window.fixture.ai());
  const localBefore = await page.evaluate(() => window.fixture.read());
  const bodyBefore = await page.evaluate(() => window.fixture.read().split('---').slice(2).join('---'));
  const open = () => page.getByRole('button', {name: '智能排版', exact: true}).click();
  const theme = () => page.getByRole('combobox', {name: '排版风格', exact: true});
  const button = name => page.getByRole('button', {name, exact: true});
  const status = () => page.locator('.easy-pub-layout [role=status]');
  await open();
  assert.equal(await page.locator('.easy-pub-layout').count(), 1);
  const viewport = page.viewportSize();
  await page.setViewportSize({width: 560, height: 640});
  assert.equal(await page.locator('.easy-pub-layout').evaluate(el => el.scrollWidth <= el.clientWidth + 2), true, 'Narrow layout modal must not overflow horizontally');
  await button('应用排版到本地稿').scrollIntoViewIfNeeded();
  assert.equal(await button('应用排版到本地稿').isVisible(), true);
  await page.setViewportSize(viewport);
  await theme().selectOption('essay');
  assert.equal(await page.evaluate(() => window.fixture.read()), localBefore);
  assert.equal(await page.evaluate(() => window.fixtureAiRequests.length), 0);
  const paragraph = await page.evaluate(() => window.fixture.view.prepared.layoutDocument.blocks.find(b => b.kind === 'paragraph'));
  const component = () => page.getByRole('combobox', {name: `第 ${paragraph.line} 行排版`, exact: true});
  await page.locator('.epl-controls details summary').click();
  await component().selectOption('highlight-card');
  // Rebuilding controls must retain their expanded state and keyboard reachability.
  await page.getByRole('checkbox', {name: `锁定第 ${paragraph.line} 行`, exact: true}).check();
  await button('准备 AI 排版请求').click();
  assert.equal(await page.evaluate(() => window.fixtureAiRequests.length), 0);
  assert.match(await page.locator('.epl-request').innerText(), /ai.example/);
  await button('确认发送这些片段并生成方案').click();
  await page.waitForFunction(() => window.fixtureAiRequests.length === 1);
  await page.evaluate(() => {
    const data = JSON.parse(JSON.parse(window.fixtureAiRequests[0].body).messages[1].content);
    window.fixtureAiResolve({schemaVersion: 1, documentHash: data.documentHash, theme: 'research', accentColor: 'blue', blocks: []});
  });
  await page.waitForFunction(() => document.querySelector('.easy-pub-layout [role=status]').textContent.includes('AI 方案已生成'));
  assert.equal(await theme().inputValue(), 'research');
  assert.equal(await component().inputValue(), 'highlight-card');
  assert.equal(await page.evaluate(() => window.fixture.read()), localBefore);
  await button('对比默认 / 当前方案').click();
  assert.equal(await page.getByRole('region', {name: '默认模板预览', exact: true}).count(), 1);
  await button('对比默认 / 当前方案').click();
  await button('应用排版到本地稿').click();
  await page.waitForFunction(() => !document.querySelector('.easy-pub-layout'));
  assert.equal(await page.evaluate(() => window.fixture.read().split('---').slice(2).join('---')), bodyBefore);
  assert.equal(await page.evaluate(() => window.fixture.view.article.layout.theme), 'research');
  assert.equal(await page.evaluate(() => window.fixture.view.article.layout.blocks.some(b => b.locked)), true);
  assert.equal(await page.evaluate(() => window.fixtureAiRequests.length), 1, 'Applying layout must not contact WeChat');
  await open();
  await button('准备 AI 排版请求').click(); await button('确认发送这些片段并生成方案').click();
  await page.waitForFunction(() => document.querySelector('.easy-pub-layout [role=status]').textContent.includes('AI 方案已生成'));
  assert.equal(await page.evaluate(() => window.fixtureAiRequests.length), 1, 'Identical requests should reuse a validated session cache');
  await theme().selectOption('event');
  await button('撤销本次调整').click();
  assert.equal(await theme().inputValue(), 'research');
  await button('取消').click();

  // Late AI results may not replace a more recent manual choice.
  await page.evaluate(() => window.fixture.clearAiCache());
  await open(); await button('准备 AI 排版请求').click(); await button('确认发送这些片段并生成方案').click();
  await page.waitForFunction(() => window.fixtureAiRequests.length === 2);
  await theme().selectOption('minimal');
  await page.evaluate(() => {
    const data = JSON.parse(JSON.parse(window.fixtureAiRequests[1].body).messages[1].content);
    window.fixtureAiResolve({schemaVersion: 1, documentHash: data.documentHash, theme: 'event', accentColor: 'rose', blocks: []});
  });
  await page.waitForFunction(() => !document.querySelector('.easy-pub-layout button.mod-cta').disabled);
  assert.equal(await theme().inputValue(), 'minimal');
  await button('取消').click();

  // Invalid structured output falls back in preview without changing saved metadata.
  await page.evaluate(() => window.fixture.clearAiCache());
  await open(); await button('准备 AI 排版请求').click(); await button('确认发送这些片段并生成方案').click();
  await page.waitForFunction(() => window.fixtureAiRequests.length === 3);
  await page.evaluate(() => window.fixtureAiResolve('{invalid JSON'));
  await page.waitForFunction(() => document.querySelector('.easy-pub-layout [role=status]').textContent.includes('回退默认'));
  assert.equal(await theme().inputValue(), 'default');
  assert.equal(await page.evaluate(() => window.fixture.view.article.layout.theme), 'research');
  await button('取消').click();

  // A source edit invalidates both a pending AI response and applying its old proposal.
  await page.evaluate(() => window.fixture.clearAiCache());
  await open(); await button('准备 AI 排版请求').click(); await button('确认发送这些片段并生成方案').click();
  await page.waitForFunction(() => window.fixtureAiRequests.length === 4);
  await page.evaluate(() => window.fixture.modify('排版确认前的新正文'));
  await page.evaluate(() => {
    const data = JSON.parse(JSON.parse(window.fixtureAiRequests[3].body).messages[1].content);
    window.fixtureAiResolve({schemaVersion: 1, documentHash: data.documentHash, theme: 'event', accentColor: 'blue', blocks: []});
  });
  await page.waitForFunction(() => document.querySelector('.easy-pub-layout [role=status]').textContent.includes('已变化'));
  await button('应用排版到本地稿').click();
  assert.match(await status().innerText(), /已变化/);
  assert.equal(await page.evaluate(() => window.fixture.view.article.layout.theme), 'research');
  await button('取消').click();
  await button('刷新预览').click();
  await page.waitForFunction(() => !window.fixture.view.stale && !window.fixture.view.busy);
  assert.match(await page.locator('.epw-status').innerText(), /过期/);

  await open(); await button('准备 AI 排版请求').click(); await button('确认发送这些片段并生成方案').click();
  await page.waitForFunction(() => window.fixtureAiRequests.length === 5);
  const savedBeforeClose = await page.evaluate(() => window.fixture.read());
  await button('取消').click();
  await page.evaluate(() => {
    const data = JSON.parse(JSON.parse(window.fixtureAiRequests[4].body).messages[1].content);
    window.fixtureAiResolve({schemaVersion: 1, documentHash: data.documentHash, theme: 'event', accentColor: 'blue', blocks: []});
  });
  assert.equal(await page.evaluate(() => window.fixture.read()), savedBeforeClose);
  console.log('Layout UI: local preview/apply, content fidelity, AI consent, locks, undo, invalid/stale/late responses and close passed');
}
