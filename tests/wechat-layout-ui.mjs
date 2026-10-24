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
  const codeGeometry = await page.locator('.epl-preview pre code').evaluate(code => {
    // Model an editor discarding raw whitespace between explicit line nodes.
    for (const node of [...code.childNodes]) if (node.nodeType === 3 && node.textContent === '\n') node.remove();
    const lines = [...code.querySelectorAll(':scope > span')];
    return {text: lines.slice(0, 2).map(line => line.textContent), tops: lines.slice(0, 2).map(line => line.getBoundingClientRect().top)};
  });
  assert.equal(codeGeometry.text.every(line => line.startsWith('    ')), true, 'Code indentation remains in original text');
  assert.ok(codeGeometry.tops[1] > codeGeometry.tops[0], 'Code lines must remain visibly separate without raw newline whitespace');
  const viewport = page.viewportSize();
  await page.setViewportSize({width: 560, height: 640});
  assert.equal(await page.locator('.easy-pub-layout').evaluate(el => el.scrollWidth <= el.clientWidth + 2), true, 'Narrow layout modal must not overflow horizontally');
  await button('应用排版到本地稿').scrollIntoViewIfNeeded();
  assert.equal(await button('应用排版到本地稿').isVisible(), true);
  await page.setViewportSize(viewport);
  assert.equal(await page.locator('.epl-theme-card').count(), 12);
  for (const [label, id] of [['杂志编排', 'editorial'], ['深夜电台', 'noir'], ['朱砂书卷', 'cinnabar']]) {
    await button(`使用${label}风格`).click();
    assert.equal(await theme().inputValue(), id);
    assert.equal(await page.getByRole('combobox', {name: '强调色', exact: true}).inputValue(), 'preset');
    assert.equal(await page.evaluate(() => window.fixture.read()), localBefore);
  }
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
  assert.equal(await button('应用排版到本地稿').isDisabled(), false, 'Manual edits can be applied while an obsolete request is still completing');
  assert.match(await status().innerText(), /旧 AI 响应将被丢弃/);
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
  await page.evaluate(() => window.fixture.setReadDelay(200));
  await page.evaluate(() => {
    const data = JSON.parse(JSON.parse(window.fixtureAiRequests[3].body).messages[1].content);
    window.fixtureAiResolve({schemaVersion: 1, documentHash: data.documentHash, theme: 'event', accentColor: 'blue', blocks: []});
  });
  await page.waitForFunction(() => window.fixtureDelayedReads > 0);
  await page.evaluate(() => window.fixture.modify('排版确认前的新正文'));
  await page.waitForFunction(() => document.querySelector('.easy-pub-layout [role=status]').textContent.includes('已变化'));
  await page.evaluate(() => window.fixture.setReadDelay(0));
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
  const reset = async text => {
    await page.evaluate(async value => { window.fixture.replace(value); await window.fixture.view.refresh(); }, text);
    await page.waitForFunction(() => !window.fixture.view.stale && !window.fixture.view.busy);
  };
  const prefix = '---\npub_id: local-id\nsource_file: "[[source]]"\n---\n';
  const image = '\n\n![cover](../../assets/cover.png)';
  const nestedText = prefix + '- safe description\n\n  ```js\n  NESTED_SECRET();\n  ```' + image;
  await reset(nestedText);
  await open(); await button('准备 AI 排版请求').click();
  await page.getByText('查看将发送的全部内容', {exact: true}).click();
  const requestPreview = await page.getByRole('textbox', {name: '将发送的全部内容'}).inputValue();
  assert.ok(!requestPreview.includes('NESTED_SECRET') && requestPreview.includes('[code preserved]'));
  assert.match(await page.locator('.epl-preview pre code').innerText(), /NESTED_SECRET/);
  await button('取消').click();
  assert.equal(await page.evaluate(() => window.fixture.read()), nestedText);

  await reset(prefix + 'x' + image);
  const overhead = await page.evaluate(() => Array.from(window.fixture.view.prepared.html).length - 1);
  const nearLimit = prefix + 'x'.repeat(19999 - overhead) + image;
  await reset(nearLimit);
  assert.equal(await page.evaluate(() => Array.from(window.fixture.view.prepared.html).length), 19999);
  await open(); await button('使用深夜电台风格').click();
  assert.match(await status().innerText(), /超过/);
  assert.equal(await button('应用排版到本地稿').isDisabled(), true);
  await button('对比默认 / 当前方案').click();
  assert.equal(await page.getByRole('region', {name: '默认模板预览'}).count(), 1);
  assert.equal(await button('应用排版到本地稿').isDisabled(), true, 'Baseline comparison must not enable saving an oversized selection');
  await button('应用排版到本地稿').evaluate(button => {
    button.closest('.easy-pub-layout').querySelector('[role=status]').textContent = '';
    button.disabled = false; button.click();
  });
  await page.waitForFunction(() => document.querySelector('.epl-footer .mod-cta').disabled && document.querySelector('.easy-pub-layout [role=status]').textContent.includes('超过'));
  assert.equal(await page.evaluate(() => window.fixture.read()), nearLimit, 'Final apply gate must reject oversized selection independently of button state');
  await button('恢复默认排版').click();
  await button('应用排版到本地稿').click();
  await page.waitForFunction(() => !document.querySelector('.easy-pub-layout'));
  assert.equal(await page.evaluate(() => window.fixture.view.prepared.issues.length), 0);
  await open(); await button('取消').click();
  const oldOversizedNote = await page.evaluate(value => {
    const hash = window.fixture.view.prepared.layoutDocument.hash;
    const plan = {schemaVersion: 1, documentHash: hash, theme: 'noir', accentColor: 'preset', blocks: []};
    return value.replace('\n---\n', '\nwechat:\n  layout: ' + JSON.stringify(plan) + '\n---\n');
  }, nearLimit);
  await reset(oldOversizedNote);
  assert.ok(await page.evaluate(() => window.fixture.view.prepared.issues.some(issue => issue.includes('超过'))));
  assert.equal(await button('同步草稿箱').isDisabled(), true);
  await open(); await button('恢复默认排版').click(); await button('应用排版到本地稿').click();
  await page.waitForFunction(() => !document.querySelector('.easy-pub-layout'));
  assert.equal(await page.evaluate(() => window.fixture.view.prepared.issues.length), 0, 'Previously saved oversized layouts must be repairable from the workbench');
  await reset(savedBeforeClose);
  console.log('Layout UI: local preview/apply, content fidelity, AI consent, locks, undo, invalid/stale/late responses and close passed');
}
