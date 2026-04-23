import path from "path";
import { normalizePath } from "obsidian";
import { Platform, PLATFORMS, PluginSettings } from "../types";

export function getPlatform(id: string): Platform | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

export function getAllPlatforms(): Platform[] {
  return PLATFORMS;
}

export function getPublishPath(
  platform: Platform,
  settings: PluginSettings,
  subFolder?: string
): string {
  // Hexo 使用外部路径
  if (platform.isExternal && platform.externalPath) {
    return path.join(settings.hexoRepoPath, platform.externalPath);
  }

  // 其他平台使用 vault 内部路径
  let publishPath = `${settings.publishBasePath}/${platform.path}`;
  if (platform.hasSubFolders && subFolder) {
    publishPath += `/${subFolder}`;
  }
  return normalizePath(publishPath);
}

export function getTargetPath(
  platform: Platform,
  settings: PluginSettings,
  title: string,
  subFolder?: string
): string {
  const publishPath = getPublishPath(platform, settings, subFolder);
  return platform.isExternal
    ? path.join(publishPath, `${sanitizeFileName(title)}.md`)
    : normalizePath(`${publishPath}/${sanitizeFileName(title)}.md`);
}

export function getSubFolder(
  platform: Platform,
  meta: Record<string, any>
): string | undefined {
  if (!platform.hasSubFolders || !platform.typeField) {
    return undefined;
  }
  const typeValue = meta[platform.typeField];
  if (platform.subFolders?.includes(typeValue)) {
    return typeValue;
  }
  return platform.subFolders?.[0]; // 默认第一个子文件夹
}

export function createWikiLink(path: string): string {
  // 移除 .md 后缀，创建 [[链接]] 格式
  const linkPath = path.replace(/\.md$/, "");
  return `[[${linkPath}]]`;
}

export function parseWikiLink(wikiLink: string): string {
  // 从 [[path]] 格式提取路径
  const match = wikiLink.match(/\[\[(.+?)\]\]/);
  return match ? match[1] : wikiLink;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").trim() || "Untitled";
}
