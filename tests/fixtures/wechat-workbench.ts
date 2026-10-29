import { WechatHexoModal } from "../../modals/WechatHexoModal";
import { exportWechatHexoContent } from "../../utils/wechatHexoContent";
import { ArticlePropertiesModal } from "../../modals/ArticlePropertiesModal";
import { platformPropertyFields } from "../../utils/articleProperties";
import { PublishingView } from "../../views/PublishingView";
import { WechatLayoutModal } from "../../modals/WechatLayoutModal";
import { TFile } from "obsidian";
import { WechatView } from "../../views/WechatView";
import { normalizeSettings } from "../../utils/settings";
import { processWechatImage, readWechatImage } from "../../utils/wechatImages";
import { Buffer } from "buffer/";
import { parseFrontMatter, stringifyFrontMatter } from "../../utils/frontMatter";
import { wechatChoice } from "../../modals/WechatChoiceModal";
import { WechatSetupModal } from "../../modals/WechatSetupModal";
import { clearWechatLayoutCache } from "../../utils/wechatAiPlanner";

async function start() {
const globals = globalThis as any;
globals.Buffer = Buffer;
const source = Object.assign(new TFile(), { path: "source.md", basename: "source", extension: "md" });
const file = Object.assign(new TFile(), { path: "发布/微信公众号/local.md", basename: "local", extension: "md" });
const attachment = Object.assign(new TFile(), { path: "assets/cover.png", basename: "cover", extension: "png" });
const alternate = Object.assign(new TFile(), {path:"assets/alternate.png",basename:"alternate",extension:"png"});
const canvas = document.createElement("canvas"); canvas.width = 1440; canvas.height = 900;
const ctx = canvas.getContext("2d")!;
ctx.fillStyle = "#e8eee4"; ctx.fillRect(0, 0, 1440, 900);
ctx.fillStyle = "#174f40"; ctx.fillRect(0, 0, 720, 900);
ctx.fillStyle = "#f2c278"; ctx.beginPath(); ctx.arc(1050, 320, 210, 0, Math.PI * 2); ctx.fill();
ctx.fillStyle = "#fff"; ctx.font = "bold 90px serif"; ctx.fillText("EasyPub", 80, 200);
ctx.font = "40px serif"; ctx.fillText("WRITE · PREVIEW · PUBLISH", 80, 280);
const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"));
const raw = await blob.arrayBuffer();
let text = "---\npub_id: local-id\nsource_file: '[[source]]'\n---\n# 把表达，留给内容\n\n这是已经独立编辑的公众号本地稿。调整配图和封面，在这里检查最终排版。\n\n![封面配图](../../assets/cover.png)\n\n## 发布之前，从容检查\n\n- 正文与原稿保持独立\n- 图片适配交给工具\n- 最后在公众号后台发布\n\n> 好的工具，让写作更专注。\n\n```ts\n    const message = 'Hello';\n    console.log(message);\n```";
const listeners = new Map<string, Set<(...args: any[]) => void>>();
const emit = (event: string, file: TFile) => listeners.get(event)?.forEach(listener => listener(file));
let delay = 0, readDelay = 0, sourceReads = 0, connected = true, settingsWrites = 0;
const imported = new Map<string,TFile>();
const app: any = {
  vault: {
    read: async (target: TFile) => {
      if (target === source) { sourceReads++; return "SOURCE MUST NOT BE READ"; }
      const snapshot = text;
      if (readDelay) { globals.fixtureDelayedReads = (globals.fixtureDelayedReads ?? 0) + 1; await new Promise(resolve => setTimeout(resolve, readDelay)); }
      return snapshot;
    },
    process: async (_file: TFile, update: (raw: string) => string) => { text = update(text); emit("modify",file); },
    readBinary: async () => { if (delay) await new Promise(resolve => setTimeout(resolve, delay)); return raw; },
    getAbstractFileByPath: (path: string) => path === file.path ? file : path === attachment.path ? attachment : path === alternate.path ? alternate : imported.get(path) ?? null,
    getFiles: () => [file, attachment, alternate, source, ...imported.values()],
    createBinary: async (path: string, _bytes: ArrayBuffer) => { const file = Object.assign(new TFile(), {path, extension:path.split(".").pop(),basename:path.split("/").pop()}); imported.set(path,file); return file; },
    on: (event: string, listener: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener); return () => listeners.get(event)?.delete(listener);
    },
  },
  metadataCache: { getFirstLinkpathDest: (path: string) => path.includes('missing') ? null : path.includes('alternate') ? alternate : attachment },
  fileManager: { getAvailablePathForAttachment: async (name: string, _sourcePath: string) => {
    let destination = `assets/${name}`, number = 1;
    while (imported.has(destination) || destination === attachment.path) destination = `assets/${number++}-${name}`;
    return destination;
  }, processFrontMatter: async (_file: TFile, callback: (data: any) => void) => {
    settingsWrites++;
    const parsed = parseFrontMatter(text);
    callback(parsed.data);
    // Match the host's metadata-only write: gray-matter would otherwise add
    // a trailing body newline and spuriously expire a layout at the limit.
    const header = stringifyFrontMatter('', parsed.data);
    const generatedBody = parseFrontMatter(header).content;
    text = header.slice(0, header.length - generatedBody.length) + parsed.content;
    emit("modify", file);
  } },
  workspace: { on: (event: string, listener: (...args: any[]) => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); return () => listeners.get(event)?.delete(listener); }, getActiveFile: () => file, requestSaveLayout: () => {}, getLeaf: () => ({ openFile: async (file: TFile, options: unknown) => { globals.fixtureOpened = { path: file.path, options }; } }) },
};
let hexoGenerated = "", hexoCommitted = 0;
let sourceUrlResult: {url?:string; reason?:string} = {};
const plugin: any = { resolveWechatSourceUrl: async () => sourceUrlResult, app, settings: normalizeSettings(null), wechatSyncInProgress: false, wechatCredentialRevision: 0,
  generateHexoFromWechat: async (_file: TFile, input: any) => {
    await input.assertFresh();
    const output = exportWechatHexoContent(input.document, image => `/picture/${image.hash}.png`);
    const diff: any = {isNew:true,targetPath:"/blog/source/_drafts/current-wechat.md",sourceContent:output.body,targetContent:null,meta:{title:input.article.title}};
    return new Promise<boolean>(resolve => new WechatHexoModal(app,diff,exportWechatHexoContent(input.document,image=>image.previewUrl).html,
      async guard => {guard();await input.assertFresh();guard();hexoGenerated=output.body;hexoCommitted++;},resolve).open());
  },
  getWechatAiConfiguration: () => ({settings: {endpoint: 'https://ai.example/v1/chat/completions', model: 'test-model', encryptedKey: '', jsonMode: true}, key: 'test-ai-key'}),
  openWechatAiSettings: () => {},
  hasWechatCredentials: () => connected, openWechatSetup: (done?:()=>void) => {connected=true; done?.();},
  relativeWechatAttachment: () => "../../assets/cover.png", openWechatBackend: async () => {}, saveSettings: async () => {},
  getWechatApi: () => ({ listDrafts: async () => [{ media_id: "recovered", content: { news_item: [{ title: "恢复测试草稿" }] } }],
    getDraft: async () => [{ title: "恢复测试草稿", content: "<p>远端正文</p>" }] }) };
const associationFiles = new Map<string,string>([["/blog/source/_drafts/nested/renamed.md", "---\npub_id: local-id\ntitle: Blog title\nabbrlink: ab12\n---\nBlog body"]]);
let associationFailure = false;
Object.assign(plugin, {
  publishDirectoryExists: async () => true,
  listPublishFiles: async (_platform: unknown, directory: string) => [...associationFiles.keys()].filter(file => file.startsWith(directory+"/")),
  readPublishFile: async (_platform: unknown, file: string) => associationFiles.get(file),
  writePublishFile: async (_platform:unknown, file:string, next:string, expected:string, guard:()=>void, before:()=>Promise<void>) => {
    await before();guard();if(associationFailure)throw new Error("fixture write failure");
    if(associationFiles.get(file)!==expected)throw new Error("concurrent edit");associationFiles.set(file,next);
  },
});
plugin.settings.hexoRepoPath = "/blog";
const view = new WechatView({ app, contentEl: document.querySelector("#workbench") } as any, plugin);
await view.onOpen(); await view.bind(file);
globals.fixture = { view,
  hexoGenerated: () => hexoGenerated, hexoCommitted: () => hexoCommitted,
  originalLink: (value: {url?:string; reason?:string}) => {sourceUrlResult=value;},
  associationFiles,
  associationFailure: (value:boolean) => {associationFailure=value;},
  selectNewCover: () => (view as any).selectCover("../../assets/alternate.png"),
  settingsWrites: () => settingsWrites,
  disconnectAccount: async () => {connected=false; await view.refresh();},
  layoutHarness: async () => {
    // This harness represents opening the editor, so request strict mapping.
    await view.refresh(false, true);
    globals.layoutReads = [];
    globals.layoutSaves = [];
    const prepared = (view as any).prepared;
    const modal = new WechatLayoutModal(plugin, {
      title: "lifecycle", html: prepared.html, images: prepared.images, document: prepared.layoutDocument,
      history: [],
      assertFresh: () => new Promise<void>(resolve => globals.layoutReads.push(resolve)),
      apply: async plan => { globals.layoutSaves.push(plan); },
    });
    globals.layoutModal = modal;
    modal.open();
  },
  setReadDelay: (value: number) => { readDelay = value; globals.fixtureDelayedReads = 0; },
  clearAiCache: () => clearWechatLayoutCache(),
  ai: () => {
    globals.fixtureAiRequests = [];
    globals.fixtureAiResolvers = [];
    globals.fixtureRequest = (request: any) => { const index = globals.fixtureAiRequests.length; globals.fixtureAiRequests.push(request); return new Promise(resolve => {
      const finish = (content: unknown) => resolve({status: 200, arrayBuffer: new TextEncoder().encode(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: typeof content === 'string' ? content : JSON.stringify(content)}}]})).buffer});
      globals.fixtureAiResolvers[index] = finish;
      globals.fixtureAiResolve = finish;
    }); };
  },
  localOnly: (value: boolean) => { plugin.settings.wechat.allowRemoteImages = !value; view.invalidateImagePolicy(); },
  setup: () => {
    const config = { ...plugin, settings: normalizeSettings(null), hasWechatCredentials: () => Boolean(config.settings.wechat.appId),
      saveWechatConfiguration: async (id: string, secret: string, author: string) => {
        if (!id) throw Error('请填写有效的 AppID');
        if (!secret) throw Error('请填写此账号的 AppSecret');
        config.settings.wechat.appId = id; config.settings.wechat.defaultAuthor = author;
        globals.fixtureSetupSaves = (globals.fixtureSetupSaves ?? 0) + 1; return false;
      },
      getWechatApi: () => ({ checkConnection: async () => {
        if (globals.fixtureSetupCheck === 'error') throw new Error('微信接口 40164：请在公众号后台配置当前出口 IP 白名单');
        return ['访问令牌正常', globals.fixtureSetupCheck === 'success' ? '素材读取正常' : '素材读取失败：账号未获此接口权限','草稿读取正常','只读检查不验证写入权限'];
      } }),
    };
    new WechatSetupModal(config).open();
  },
  networkImage: async (status: number) => {
    globals.fixtureRequest = async () => ({ status, arrayBuffer: raw });
    try { const result = await readWechatImage(app, 'https://example.com/image.png', file.path, async () => {
      if (status !== 200) throw new Error(`下载失败 HTTP ${status}`);
      return new Uint8Array(raw);
    }); return { size:result.bytes.length }; }
    catch (error) { return { error:(error as Error).message }; }
  },
  compare: () => wechatChoice(app, '微信后台内容与上次同步不同', '原始内容供核对', [{ label:'另建草稿', value:'new' }], [
    { label:'标题', local:'本地修改后的标题', remote:'后台保留的标题' },
    { label:'正文', local:'共同段落\n新增内容 <script>只是文字</script>', remote:'共同段落\n旧内容' },
  ]),
  draftState: () => plugin.settings.wechat.drafts[":local-id"],
  markUncertain: () => { plugin.settings.wechat.drafts[":local-id"] = { mediaId: "old", uncertain: true }; },
  read: () => text,
  replace: (value: string) => { text = value; emit("modify", file); },
  modify: (suffix: string) => { text += `\n\n${suffix}`; emit("modify", file); },
  setDelay: (value: number) => { delay = value; },
  sourceReads: () => sourceReads,
  openSource: () => emit("file-open", source),
  close: async () => { await view.onClose(); view.unload(); },
  processImage: async (transparent: boolean) => {
    const sample = document.createElement("canvas"); sample.width = 2200; sample.height = 1200;
    const c = sample.getContext("2d")!; c.fillStyle = "#cba"; c.fillRect(0, 0, transparent ? 1000 : 2200, 1200);
    const data = await new Promise<Blob>(resolve => sample.toBlob(b => resolve(b!), "image/png"));
    const result = await processWechatImage("test.png", new Uint8Array(await data.arrayBuffer()), "body");
    URL.revokeObjectURL(result.previewUrl);
    return { mime: result.mime, size: result.bytes.length, width: result.width, height: result.height };
  },
};
if (document.querySelector("#publishing")) {
  plugin.manifest = { id: "easy-pub" };
  plugin.resolvePublishingSource = () => source;
  plugin.openHexoControlRoom = async () => { document.querySelector("#verification")!.textContent = "Hexo 管理后台入口已触发"; };
  plugin.openRelatedDraft = async () => {};
  plugin.hasRelatedDraft = async () => false;
  plugin.preparePublish = async () => { document.querySelector("#verification")!.textContent = "创建稿件入口已触发"; };
  const panel = new PublishingView({app,contentEl:document.querySelector("#publishing")} as any, plugin);
  await panel.onOpen();
}
globals.openAttachmentProperties = () => {
  new ArticlePropertiesModal(app, {title:"生成微信公众号稿件",description:"确认文章属性，上传封面后继续生成。", fields:platformPropertyFields("wechat"),
    current:{title:"从写作到发布"}, suggested:{},attachmentSourcePath:source.path}, value => {
      document.querySelector("#verification")!.textContent = value ? JSON.stringify(value,null,2) : "已取消生成，已上传的附件保留";
    }).open();
};
globals.fixtureReady = true;
}
void start();
