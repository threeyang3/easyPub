import assert from 'node:assert/strict';
export async function runWechatHexoUi(page) {
  const original = await page.evaluate(()=>window.fixture.read());
  const commits = await page.evaluate(()=>window.fixture.hexoCommitted());
  await page.evaluate(async()=>{
    window.fixture.replace('---\npub_id: local-id\nsource_file: "[[source]]"\n---\n## 公众号独立标题\n\n保留这一段正文。\n\n> 引用排版\n\n```ts\n  const a = 1;\n  next(a);\n```\n\n![Cover](../../assets/cover.png)');
    await window.fixture.view.refresh();
  });
  const create = () => page.getByRole('button',{name:'生成 Hexo 稿（保留排版）',exact:true}).click();
  await create();
  const dialog = page.getByRole('dialog');
  assert.match(await dialog.innerText(),/将新建 Hexo 草稿/);
  assert.equal(await dialog.locator('.ep-wechat-hexo-preview h2').innerText(),'公众号独立标题');
  assert.match(await dialog.locator('.ep-wechat-hexo-preview pre').innerText(),/const a = 1/);
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixture.hexoCommitted()),commits);
  await create();
  await dialog.getByRole('button',{name:'确认生成 Hexo 草稿',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  const html = await page.evaluate(()=>window.fixture.hexoGenerated());
  assert.match(html,/easy-pub-wechat-layout/);assert.match(html,/!important/);
  assert.match(html,/src="\/picture\//);assert.doesNotMatch(html,/blob:|easy-pub-image:/);
  await page.getByRole('status').filter({hasText:'Hexo 稿已保存'}).waitFor();
  await create();
  await page.evaluate(()=>window.fixture.replace(window.fixture.read()+'\nExternal edit'));
  await dialog.getByRole('button',{name:'确认生成 Hexo 草稿',exact:true}).click();
  await dialog.getByRole('status').filter({hasText:'已变化'}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.hexoCommitted()),commits+1);
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await page.evaluate(async text=>{window.fixture.replace(text);await window.fixture.view.refresh();},original);
  console.log('WeChat to Hexo browser: entry, rendered layout, cancel, image URLs, save and stale preview guards passed.');
}
