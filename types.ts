export interface PluginSettings {
  hexoRepoPath: string;     // Hexo 仓库根目录
  autoDeploy: boolean;
  publishBasePath: string;  // 其他平台发布路径基础目录，默认 "发布"
  imageHandling: "local" | "picgo";
  picgoServerUrl: string;
  picgoServerSecret: string;
  picgoEncryptedSecret: string;
  picgoImageCache: Record<string, PicGoImageCacheEntry>;
  wechat: WechatSettings;
  wechatAi?: WechatAiSettings;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  hexoRepoPath: "",
  autoDeploy: false,
  publishBasePath: "发布",
  imageHandling: "local",
  picgoServerUrl: "http://127.0.0.1:36677/upload",
  picgoServerSecret: "",
  picgoEncryptedSecret: "",
  picgoImageCache: {},
  wechat: { appId: "", encryptedSecret: "", defaultAuthor: "", allowRemoteImages: true, assets: {}, drafts: {} },
};

export interface PicGoImageCacheEntry {
  hash: string;
  url: string;
}

export interface Platform {
  id: string;
  name: string;
  path: string;           // 相对于 publishBasePath（Hexo 除外）
  hasSubFolders: boolean;
  subFolders?: string[];  // 子文件夹列表（知乎用）
  typeField?: string;     // 用于区分子文件夹的字段
  autoUrl: boolean;       // 是否自动生成发布链接
  isExternal: boolean;    // 是否使用外部路径（Hexo）
  externalPath?: string;  // 外部路径模板（相对于 hexoRepoPath）
}

export type FrontMatterData = Record<string, unknown>;

export interface PublishBackupEntry { name: string; path: string; bytes: number; savedAt: number }
export interface PublishBackupPreview {
  content: string;
  hashMatches: boolean;
  title?: string;
  source?: string;
  pubId?: string;
  metadataValid: boolean;
}

export interface PublishDirectoryReport {
  checked: number;
  issues: Array<{ kind: "invalid" | "unreadable" | "duplicate" | "missing-id"; paths: string[]; message: string }>;
}

export interface ParsedFrontMatter<T extends FrontMatterData = FrontMatterData> {
  data: T;
  content: string;
}

export const PLATFORMS: Platform[] = [
  {
    id: "hexo",
    name: "Hexo",
    path: "Hexo",
    hasSubFolders: false,
    autoUrl: true,
    isExternal: true,
    externalPath: "source/_posts",
  },
  {
    id: "zhihu",
    name: "知乎",
    path: "知乎",
    hasSubFolders: true,
    subFolders: ["文章", "想法"],
    typeField: "zhihu_type",
    autoUrl: false,
    isExternal: false,
  },
  {
    id: "wechat",
    name: "微信公众号",
    path: "微信公众号",
    hasSubFolders: false,
    autoUrl: false,
    isExternal: false,
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    path: "小红书",
    hasSubFolders: false,
    autoUrl: false,
    isExternal: false,
  },
];

export interface ArticleMeta {
  pub_id: string;
  title?: string;
  date?: unknown;
  updated?: string;
  categories?: string[];
  tags?: string[];
  子文件?: string[] | string; // 主文件维护的发布文件链接列表
  source_file?: string;   // 发布文件记录的源文件链接
  publish_url?: string;   // 发布链接
  zhihu_type?: string;    // 知乎文章类型：文章/想法
  [key: string]: unknown;
}

export interface ArticleDiff {
  pub_id: string;
  sourcePath: string;
  targetPath: string;
  sourceContent: string;
  targetContent: string | null;
  isNew: boolean;
  meta: ArticleMeta;
  platform: Platform;
  assets?: PublishAsset[];
  picgoUploads?: PicGoPendingUpload[];
  sourceSnapshot?: string;
  settingsFingerprint?: string;
  imageChecks?: Array<{ sourcePath: string; contentHash: string }>;
}

export interface PublishAsset {
  sourcePath: string;
  targetPath: string;
  contentHash?: string;
}

export interface PicGoPendingUpload {
  sourcePath: string;
  localPath: string;
  contentHash: string;
  token: string;
}

export interface WechatCrop { x: number; y: number; width: number; height: number }
export interface WechatArticleSettings {
  title?: string;
  author?: string;
  digest?: string;
  sourceUrl?: string;
  cover?: string;
  cropWide?: WechatCrop;
  cropSquare?: WechatCrop;
  layout?: WechatLayoutPlan;
  layoutHistory?: WechatLayoutPlan[];
}
export type WechatThemeId = "default" | "essay" | "research" | "event" | "minimal" | "editorial" | "paper" | "noir" | "bloom" | "cobalt" | "cinnabar" | "mono";
export type WechatAccent = "preset" | "teal" | "blue" | "amber" | "rose";
export type WechatBlockKind = "paragraph" | "heading" | "list" | "quote" | "code" | "image" | "table" | "divider" | "other";
export type WechatLayoutComponent = "plain" | "intro" | "highlight-card" | "quote" | "conclusion";
export type WechatLayoutRole = "body" | "lead" | "key-point" | "quotation" | "summary";
export interface WechatLayoutBlock { id: string; kind: WechatBlockKind; line: number; text: string }
export interface WechatLayoutDocument { hash: string; blocks: WechatLayoutBlock[] }
export interface WechatLayoutInstruction { id: string; role: WechatLayoutRole; component: WechatLayoutComponent; locked?: boolean }
export interface WechatLayoutPlan {
  schemaVersion: 1;
  documentHash: string;
  theme: WechatThemeId;
  accentColor: WechatAccent;
  blocks: WechatLayoutInstruction[];
}
export interface WechatAiSettings { endpoint: string; model: string; encryptedKey: string; jsonMode: boolean }
export interface WechatArticle {
  title: string;
  author: string;
  digest: string;
  content: string;
  content_source_url: string;
  thumb_media_id: string;
  cover_info: { crop_percent_list: Array<{ ratio: string; x1: string; y1: string; x2: string; y2: string }> };
}
export interface WechatAssetCache { mediaId?: string; url: string }
export interface WechatDraftState {
  mediaId?: string;
  fingerprint?: string;
  syncedAt?: string;
  uncertain?: boolean;
}
export interface WechatSettings {
  allowRemoteImages?: boolean;
  appId: string;
  encryptedSecret: string;
  defaultAuthor: string;
  assets: Record<string, WechatAssetCache>;
  drafts: Record<string, WechatDraftState>;
}
export interface WechatImage {
  source: string;
  hash: string;
  originalHash: string;
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  previewUrl: string;
  localPath?: string;
  originalSize: number;
}
export interface WechatImageReference {
  source: string;
  line: number;
  status: "ready" | "error";
  error?: string;
}
export interface WechatPreparedDocument {
  html: string;
  images: WechatImage[];
  issues: string[];
  imageReferences?: WechatImageReference[];
  layoutDocument?: WechatLayoutDocument;
  layoutNotice?: string;
}
