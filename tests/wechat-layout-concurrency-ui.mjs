import assert from 'node:assert/strict';

export async function runLayoutConcurrencyUi(page) {
  await page.evaluate(() => {window.fixture.ai(); window.fixture.clearAiCache();});
  const button = name => page.getByRole('button', {name, exact:true});
  const theme = () => page.getByRole('combobox', {name:'排版风格', exact:true});
  await button('智能排版').click();
  await page.locator('.epl-ai-section > summary').click();
  const send = async expected => {
    await button('准备 AI 排版请求').click();
    await button('确认发送这些片段并生成方案').click();
    await page.waitForFunction(count => window.fixtureAiRequests.length === count, expected);
  };
  const ready = () => page.waitForFunction(() => !document.querySelector('.epl-footer .mod-cta').disabled);
  const resolve = index => page.evaluate(i => {
    const data = JSON.parse(JSON.parse(window.fixtureAiRequests[i].body).messages[1].content);
    window.fixtureAiResolvers[i]({schemaVersion:1, documentHash:data.documentHash, theme:'noir', accentColor:'preset', blocks:[]});
  }, index);
  await send(1);
  await theme().selectOption('minimal'); await ready();
  await send(2); // The first transport is still unresolved.
  await resolve(0);
  await page.waitForFunction(() => window.fixture.view.layoutModal.requests.size === 1);
  assert.equal(await button('应用排版到本地稿').isDisabled(), true, 'Old completion cannot clear a newer request');
  assert.equal(await theme().inputValue(), 'minimal');
  await theme().selectOption('research'); await ready();
  await send(3);
  await theme().selectOption('event'); await ready();
  assert.equal(await button('准备 AI 排版请求').isDisabled(), true, 'Two obsolete transports cap concurrency without blocking manual apply');
  assert.equal(await page.evaluate(() => window.fixtureAiRequests.length), 3);
  await resolve(2); // Complete out of order, while both responses are obsolete.
  await page.waitForFunction(() => window.fixture.view.layoutModal.requests.size === 1);
  await resolve(1);
  await page.waitForFunction(() => window.fixture.view.layoutModal.requests.size === 0);
  assert.equal(await theme().inputValue(), 'event');
  assert.equal(await button('准备 AI 排版请求').isDisabled(), false);
  await button('应用排版到本地稿').click();
  await page.waitForFunction(() => !document.querySelector('.easy-pub-layout'));
  assert.equal(await page.evaluate(() => window.fixture.view.article.layout.theme), 'event');
  console.log('Layout concurrency: obsolete/new requests, bounded transport count, reverse completion and manual apply passed');
}
