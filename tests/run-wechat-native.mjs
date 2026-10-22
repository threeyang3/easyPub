import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

// Uses the host's own plugin loader in memory, without installing/enabling a
// plugin on disk or touching any notes. Requires a running Obsidian with CLI.
const temp = await mkdtemp(path.join(os.tmpdir(), 'easypub-native-'));
try {
  const entry = process.argv.includes('--download') ? 'tests/wechat-download-native.ts' : 'tests/wechat-native.ts';
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', external: ['obsidian','electron','@electron/remote'], write: false });
  const file = path.join(temp, 'native.cjs');
  await writeFile(file, result.outputFiles[0].text + '\nconst runAcceptance=module.exports.run; module.exports=class extends require("obsidian").Plugin { async onload(){this.result=await runAcceptance(this.app);} };');
  const id = `easypub-acceptance-${Date.now()}`;
  const code = `(async()=>{
    const id=${JSON.stringify(id)}, manager=app.plugins, adapter=app.vault.adapter;
    const read=adapter.read, virtual=id+'/main.js';
    manager.manifests[id]={id,name:'EasyPub acceptance',version:'0.0.0',minAppVersion:'1.4.4',dir:id};
    adapter.read=async function(p,...args){return p===virtual?require('fs').readFileSync(${JSON.stringify(file)},'utf8'):read.call(this,p,...args);};
    try { const plugin=await manager.loadPlugin(id); return JSON.stringify(plugin.result); }
    finally { adapter.read=read; await manager.unloadPlugin(id); delete manager.manifests[id]; }
  })()`;
  const cli = process.env.OBSIDIAN_CLI ?? (process.platform === 'win32' ? 'C:/Program Files/Obsidian/Obsidian.com' : 'obsidian');
  const run = spawnSync(cli, [`vault=${process.env.EASYPUB_TEST_VAULT ?? 'Sandbox'}`, 'eval', `code=${code}`], { encoding: 'utf8', timeout: 60000 });
  process.stdout.write(run.stdout ?? ''); process.stderr.write(run.stderr ?? '');
  if (run.error || run.status !== 0 || !run.stdout.includes('"checks"')) throw new Error('Native acceptance failed; see Obsidian output above');
} finally { await rm(temp, { recursive: true, force: true }); }
