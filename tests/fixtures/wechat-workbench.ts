import { TFile } from "obsidian";
import { WechatView } from "../../views/WechatView";
import { normalizeSettings } from "../../utils/settings";
import { processWechatImage, readWechatImage } from "../../utils/wechatImages";
import { Buffer } from "buffer/";
import { parseFrontMatter, stringifyFrontMatter } from "../../utils/frontMatter";
import { wechatChoice } from "../../modals/WechatChoiceModal";
import { WechatSetupModal } from "../../modals/WechatSetupModal";

async function start() {
const globals = globalThis as any;
globals.Buffer = Buffer;
const source = Object.assign(new TFile(), { path: "source.md", basename: "source", extension: "md" });
const file = Object.assign(new TFile(), { path: "发布/微信公众号/local.md", basename: "local", extension: "md" });
const attachment = Object.assign(new TFile(), { path: "assets/cover.png", basename: "cover", extension: "png" });
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
let delay = 0, sourceReads = 0;
const app: any = {
  vault: {
    read: async (target: TFile) => { if (target === source) { sourceReads++; return "SOURCE MUST NOT BE READ"; } return text; },
    readBinary: async () => { if (delay) await new Promise(resolve => setTimeout(resolve, delay)); return raw; },
    getAbstractFileByPath: (path: string) => path === file.path ? file : path === attachment.path ? attachment : null,
    getFiles: () => [file, attachment, source],
    on: (event: string, listener: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener); return () => listeners.get(event)?.delete(listener);
    },
  },
  metadataCache: { getFirstLinkpathDest: (path: string) => path.includes('missing') ? null : attachment },
  fileManager: { processFrontMatter: async (_file: TFile, callback: (data: any) => void) => {
    const parsed = parseFrontMatter(text);
    callback(parsed.data);
    text = stringifyFrontMatter(parsed.content, parsed.data);
    emit("modify", file);
  } },
  workspace: { getLeaf: () => ({ openFile: async (file: TFile, options: unknown) => { globals.fixtureOpened = { path: file.path, options }; } }) },
};
const plugin: any = { app, settings: normalizeSettings(null), wechatSyncInProgress: false, wechatCredentialRevision: 0,
  hasWechatCredentials: () => true, openWechatSetup: () => {},
  relativeWechatAttachment: () => "../../assets/cover.png", openWechatBackend: async () => {}, saveSettings: async () => {},
  getWechatApi: () => ({ listDrafts: async () => [{ media_id: "recovered", content: { news_item: [{ title: "恢复测试草稿" }] } }],
    getDraft: async () => [{ title: "恢复测试草稿", content: "<p>远端正文</p>" }] }) };
const view = new WechatView({ app, contentEl: document.querySelector("#workbench") } as any, plugin);
await view.onOpen(); await view.bind(file);
globals.fixture = { view,
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
    try { const result = await readWechatImage(app, 'https://example.com/image.png', file.path); return { size:result.bytes.length }; }
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
globals.fixtureReady = true;
}
void start();
