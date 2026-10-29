import { build } from 'esbuild';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

// Uses the host's own plugin loader in memory, without installing/enabling a
// plugin on disk. WeChat checks do not touch notes; --hexo creates and cleans
// dedicated Sandbox notes and requires a marked disposable blog copy.
const temp = await mkdtemp(path.join(os.tmpdir(), 'easypub-native-'));
try {
  const performance = process.argv.includes('--performance');
  const picker = process.argv.includes('--file-picker');
  const workbench = process.argv.includes('--workbench');
  const hexo = process.argv.includes('--hexo');
  const editing = process.argv.includes('--hexo-editing');
  const draftSync = process.argv.includes('--draft-sync');
  if ((hexo || workbench) && !process.env.EASYPUB_TEST_HEXO_REPO) throw new Error('Set EASYPUB_TEST_HEXO_REPO to a disposable blog copy');
  const entry = draftSync ? 'tests/draft-sync-native.ts' : editing ? 'tests/hexo-editing-native.ts' : performance ? 'tests/performance-native.ts' : picker ? 'tests/attachment-picker-native.ts' : workbench ? 'tests/workbench-native.ts' : hexo ? 'tests/hexo-native.ts' : process.argv.includes('--download') ? 'tests/wechat-download-native.ts' : 'tests/wechat-native.ts';
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', external: ['obsidian','electron','@electron/remote'], write: false });
  const file = path.join(temp, 'native.cjs');
  const pickerImagePath=picker ? path.join(temp,'easypub-native-picker-test.png') : undefined;
  if(picker) {
    await writeFile(pickerImagePath,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=','base64'));
    console.log(`Native picker test image: ${pickerImagePath}`);
  }
  const options = {pickerImagePath, imageUrl: process.env.EASYPUB_TEST_IMAGE_URL?.trim() || undefined, blogPath: process.env.EASYPUB_TEST_HEXO_REPO, ...(workbench || picker ? {styles:await readFile("styles.css","utf8")} : {}) };
  await writeFile(file, result.outputFiles[0].text + '\nconst runAcceptance=module.exports.run; module.exports=class extends require("obsidian").Plugin { async onload(){this.result=await runAcceptance.call(this,this.app,' + JSON.stringify(options) + ');} };');
  const id = `easypub-acceptance-${Date.now()}`;
  const code = `(async()=>{
    const id=${JSON.stringify(id)}, manager=app.plugins, adapter=app.vault.adapter;
    const read=adapter.read, virtual=id+'/main.js';
    manager.manifests[id]={id,name:'EasyPub acceptance',version:'0.0.0',minAppVersion:'1.5.7',dir:id};
    adapter.read=async function(p,...args){return p===virtual?require('fs').readFileSync(${JSON.stringify(file)},'utf8'):read.call(this,p,...args);};
    try { const plugin=await manager.loadPlugin(id); return JSON.stringify(plugin.result); }
    finally { adapter.read=read; await manager.unloadPlugin(id); delete manager.manifests[id]; }
  })()`;
  const cli = process.env.OBSIDIAN_CLI ?? (process.platform === 'win32' ? 'C:/Program Files/Obsidian/Obsidian.com' : 'obsidian');
  const run = spawnSync(cli, [`vault=${process.env.EASYPUB_TEST_VAULT ?? 'Sandbox'}`, 'eval', `code=${code}`], { encoding: 'utf8', timeout: performance ? 180000 : hexo ? 660000 : picker ? 180000 : 60000 });
  process.stdout.write(run.stdout ?? ''); process.stderr.write(run.stderr ?? '');
  let acceptance;
  for (const line of (run.stdout ?? '').split(/\r?\n/)) {
    if (!line.startsWith('=> ')) continue;
    try { acceptance = JSON.parse(line.slice(3)); } catch { /* Ignore non-result CLI output. */ }
  }
  if (run.error || run.status !== 0 || !Array.isArray(acceptance?.checks) || !acceptance.checks.length) {
    throw new Error('Native acceptance failed; see Obsidian output above');
  }
} finally { await rm(temp, { recursive: true, force: true }); }
