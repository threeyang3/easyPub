export interface PluginSettings {
  hexoRepoPath: string;     // Hexo 仓库根目录
  writingPath: string;
  autoDeploy: boolean;
  publishBasePath: string;  // 其他平台发布路径基础目录，默认 "发布"
}

export const DEFAULT_SETTINGS: PluginSettings = {
  hexoRepoPath: "",
  writingPath: "",
  autoDeploy: true,
  publishBasePath: "发布",
};

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
  title: string;
  date: string;
  updated?: string;
  categories?: string[];
  tags?: string[];
  子文件?: string[];      // 主文件维护的发布文件链接列表
  source_file?: string;   // 发布文件记录的源文件链接
  publish_url?: string;   // 发布链接
  zhihu_type?: string;    // 知乎文章类型：文章/想法
  [key: string]: any;
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
}
