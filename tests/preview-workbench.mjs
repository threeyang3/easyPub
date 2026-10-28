// Browser-free preview server: use the in-app browser, never launch a desktop browser here.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const bundle = await build({ entryPoints:['tests/fixtures/wechat-workbench.ts'], bundle:true, platform:'browser', format:'esm', write:false, external:['electron'],
  plugins:[{name:'preview-fixtures',setup(build) {
    build.onResolve({filter:/^obsidian$/},()=>({path:path.resolve('tests/fixtures/wechat-obsidian.ts')}));
    build.onResolve({filter:/^crypto$/},()=>({path:'crypto',namespace:'fixture'}));
    build.onResolve({filter:/^path$/},()=>({path:'path',namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='path' ? `export default {join:(...p)=>p.join('/')};` : `export const createHash=()=>({data:'',update(v){this.data=String(v);return this;},digest(){let h=2166136261;for(const c of this.data)h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16).padStart(8,'0').repeat(8);}}); export const randomBytes=n=>({toString:()=>'a'.repeat(n*2)});`,loader:'js'}));
  }}] });
const css = await readFile('styles.css','utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><title>EasyPub 工作台验收</title><style>
:root{--background-primary:#fff;--background-secondary:#f3f3f3;--background-modifier-border:#ddd;--text-muted:#666;--text-normal:#222;--text-error:#b22;--interactive-accent:#6554c0;--font-interface:system-ui}*{box-sizing:border-box}body{margin:0;font:14px system-ui;color:var(--text-normal);background:#ececec}main{padding:20px;position:fixed;width:calc(100% - 360px)}aside{background:var(--background-primary);position:fixed;right:0;top:0;bottom:0;width:360px}button,input,select,textarea{font:inherit;border:1px solid #ccc;padding:7px;border-radius:4px;background:#fff;color:inherit}button{cursor:pointer}button:disabled{opacity:.45} .preview-controls{display:flex;gap:8px;flex-wrap:wrap}#publishing{background:#fff;max-width:360px;margin-top:20px;height:70vh}.wide #workbench{width:920px}.narrow #workbench{width:320px}#verification{white-space:pre-wrap}
</style><style>${css}</style></head><body><main><h1>EasyPub 工作台验收</h1><div class="preview-controls"><button id="narrow">320px 侧栏</button><button id="normal">360px 侧栏</button><button id="wide">920px 工作台</button><button id="simulate">修改正文</button><button id="check">检查裁剪与保存状态</button><button id="attachments">生成稿件并添加图片</button></div><pre id="verification"></pre><section id="publishing"></section></main><aside id="workbench"></aside><script type="module" src="/fixture.js"></script><script>
for(const size of ['narrow','normal','wide'])document.getElementById(size).onclick=()=>document.body.className=size==='normal'?'':size;
document.getElementById('attachments').onclick=()=>window.openAttachmentProperties();
document.getElementById('simulate').onclick=()=>window.fixture.modify('异步修改后的正文');
document.getElementById('check').onclick=()=>document.getElementById('verification').textContent=JSON.stringify({article:window.fixture.view.article,dirty:window.fixture.view.dirty,cropOpen:!!window.fixture.view.cropModal,previewHidden:document.querySelector('.epw-paper').hidden,inspectorHidden:document.querySelector('.epw-inspector').hidden},null,2);
</script></body></html>`;
http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/fixture.js'?bundle.outputFiles[0].text:html);}).listen(4197,'127.0.0.1',()=>console.log('Preview http://127.0.0.1:4197'));
