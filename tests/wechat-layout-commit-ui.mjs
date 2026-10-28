import assert from 'node:assert/strict';

// Exercise the real WechatView callback, not just the modal's in-memory harness.
export async function runLayoutCommitUi(page) {
  const button = name => page.getByRole('button', {name, exact: true});
  await page.evaluate(() => {
    const view = window.fixture.view;
    const read = view.app.vault.read.bind(view.app.vault);
    const write = view.app.fileManager.processFrontMatter.bind(view.app.fileManager);
    window.commitTest = {reads: [], commits: [], written: [], gate: false, gateCommit: false};
    view.app.vault.read = file => window.commitTest.gate
      ? new Promise((resolve, reject) => window.commitTest.reads.push({resolve: () => resolve(read(file)), reject})) : read(file);
    view.app.fileManager.processFrontMatter = async (file, callback) => {
      if (window.commitTest.gateCommit) await new Promise((resolve, reject) => window.commitTest.commits.push({resolve, reject}));
      return write(file, data => { callback(data); window.commitTest.written.push(data.wechat.layout.theme); });
    };
    window.commitTest.restore = () => { view.app.vault.read = read; view.app.fileManager.processFrontMatter = write; };
  });
  const resolveRead = async () => {
    await page.waitForFunction(() => window.commitTest.reads.length === 1);
    await page.evaluate(() => window.commitTest.reads.shift().resolve());
  };
  try {
    // Two immediate opens must acquire one opening slot before their first disk read.
    await page.evaluate(() => {
      window.commitTest.gate = true;
      const button = [...document.querySelectorAll('button')].find(el => el.textContent === '智能排版');
      button.click(); button.click();
    });
    assert.equal(await page.evaluate(() => window.commitTest.reads.length), 1);
    // Lazy mapping adds a snapshot read and a post-render consistency read
    // before the editor's own freshness check. Drain only the opening reads;
    // both immediate clicks must still share the same opening slot.
    for (let step = 0; step < 3; step++) {
      await resolveRead();
      await page.waitForFunction(() => document.querySelector('.easy-pub-layout') || window.commitTest.reads.length > 0);
      if (await page.locator('.easy-pub-layout').count()) break;
    }
    assert.equal(await page.locator('.easy-pub-layout').count(), 1);
    await button('取消').click();
    await page.evaluate(() => { window.commitTest.gate = false; });

    for (const phase of ['workbench-read', 'save-read', 'host-callback']) {
      const before = await page.evaluate(() => window.fixture.read());
      await button('智能排版').click();
      await page.getByRole('combobox', {name: '排版风格', exact: true}).selectOption('cinnabar');
      await page.evaluate(phase => {
        window.commitTest.gate = true;
        window.commitTest.gateCommit = phase === 'host-callback';
      }, phase);
      await button('应用排版到本地稿').click();
      await resolveRead(); // Modal check completed; real workbench read is pending.
      if (phase !== 'workbench-read') await resolveRead();
      if (phase === 'host-callback') {
        await resolveRead();
        await page.waitForFunction(() => window.commitTest.commits.length === 1);
      } else await page.waitForFunction(() => window.commitTest.reads.length === 1);
      assert.equal(await page.evaluate(() => window.fixture.view.busy), true);
      const competing = await page.evaluate(async () => {
        const modal = window.fixture.view.layoutModal;
        try { await modal.context.apply({...modal.selected, theme: 'noir'}, () => {}); return 'allowed'; }
        catch (error) { return error.message; }
      });
      assert.match(competing, /正在进行/);
      await button('取消').click();
      await page.evaluate(() => {
        window.commitTest.gate = false; window.commitTest.gateCommit = false;
        window.commitTest.reads.splice(0).forEach(item => item.resolve());
        window.commitTest.commits.splice(0).forEach(item => item.resolve());
      });
      await page.waitForFunction(() => !window.fixture.view.busy);
      assert.equal(await page.evaluate(() => window.fixture.read()), before, phase);
      assert.deepEqual(await page.evaluate(() => window.commitTest.written), [], phase);
      assert.equal(await page.locator('.easy-pub-layout').count(), 0);
    }

    // A failed host write releases the lock; retry saves one exact plan/history entry.
    await button('智能排版').click();
    await page.getByRole('combobox', {name: '排版风格', exact: true}).selectOption('essay');
    const before = await page.evaluate(() => window.fixture.read());
    const historyLength = await page.evaluate(() => window.fixture.view.article.layoutHistory?.length ?? 0);
    await page.evaluate(() => { window.commitTest.gateCommit = true; });
    await button('应用排版到本地稿').click();
    await page.waitForFunction(() => window.commitTest.commits.length === 1);
    await page.evaluate(() => window.commitTest.commits.shift().reject(new Error('simulated disk failure')));
    await page.waitForFunction(() => !window.fixture.view.busy);
    assert.match(await page.locator('.easy-pub-layout [role=status]').innerText(), /simulated disk failure/);
    assert.equal(await page.evaluate(() => window.fixture.read()), before);
    await page.evaluate(() => { window.commitTest.gateCommit = false; });
    await button('应用排版到本地稿').click();
    await page.waitForFunction(() => !window.fixture.view.busy && !document.querySelector('.easy-pub-layout'));
    assert.deepEqual(await page.evaluate(() => window.commitTest.written), ['essay']);
    assert.equal(await page.evaluate(() => window.fixture.view.article.layoutHistory.length), Math.min(5, historyLength + 1));
    await button('智能排版').click();
    await button('取消').click();
  } finally { await page.evaluate(() => window.commitTest.restore()); }
  console.log('Layout commit UI: real callback cancellation, single window, workbench mutex and failed-write retry passed');
}
