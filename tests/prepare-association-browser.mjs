// Prepare the same real workbench fixture without launching any browser.
// Serve output and exercise it with the in-app browser.
import { build } from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const output=process.argv[2];if(!output)throw new Error('Pass an output directory');
const bundle=await build({entryPoints:['tests/fixtures/wechat-workbench.ts'],bundle:true,platform:'browser',format:'esm',write:false,external:['electron'],plugins:[{name:'browser-fixtures',setup(build){
  build.onResolve({filter:/^obsidian$/},()=>({path:path.resolve('tests/fixtures/wechat-obsidian.ts')}));
  build.onResolve({filter:/^(crypto|path|url)$/},args=>({path:args.path,namespace:'fixture'}));
  build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='url'?`export const fileURLToPath=p=>new URL(p).pathname;`:args.path==='path'?`export default {join:(...parts)=>parts.join('/'),isAbsolute:p=>p.startsWith('/')};`:`export const createHash=()=>({data:'',update(v){this.data=String(v);return this;},digest(){let h=2166136261;for(const c of this.data)h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0).toString(16).padStart(8,'0').repeat(8);}});export const randomBytes=n=>({toString:()=>'a'.repeat(n*2)});`,loader:'js'}));
}}]});
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'workbench.js'),bundle.outputFiles[0].text);
await writeFile(path.join(output,'styles.css'),await readFile('styles.css'));
await writeFile(path.join(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><style>:root{--background-primary:#fff;--background-secondary:#f4f4f4;--text-normal:#333;--text-muted:#666;--background-modifier-border:#ddd}body{margin:0;font:14px system-ui}#workbench{height:100vh;max-width:1100px;margin:auto}button,input,select{font:inherit;padding:8px;margin:4px}</style><nav><button id="fail">模拟 Hexo 同步失败</button><button id="recover">恢复 Hexo 同步</button><button id="inspect">查看测试存储</button><pre id="store"></pre></nav><aside id="workbench"></aside><script type="module" src="workbench.js"></script><script>document.querySelector('#fail').onclick=()=>window.fixture.associationFailure(true);document.querySelector('#recover').onclick=()=>window.fixture.associationFailure(false);document.querySelector('#inspect').onclick=()=>document.querySelector('#store').textContent=window.fixture.read()+'\\nHEXO: '+[...window.fixture.associationFiles.values()].join('\\n');</script></html>`);
console.log(output);
