import fs from "fs/promises";
import path from "path";
import { TFile, TFolder, normalizePath, Vault } from "obsidian";
import { Platform } from "../types";
import { getPublishBackupDirectory } from "./platforms";
import { backupGitMessage, inspectPublishBackups } from "./publishBackups";
import { writePublishedFile } from "./publishFiles";
import { assertPublishUnchanged } from "./publishSafety";

/** IO boundary: Vault APIs for local drafts, Node fs for external blog files.
 * The repository getter deliberately follows live settings rather than a cached path.
 */
export class PublishStore {
  constructor(private vault: () => Vault, private repository: () => string,
    private notify: (message: string, timeout?: number) => void) {}

  async publishPathExists(platform: Platform, filePath: string): Promise<boolean> {
    if (!platform.isExternal) {
      return this.vault().getAbstractFileByPath(filePath) instanceof TFile;
    }

    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async publishDirectoryExists(platform: Platform, directoryPath: string): Promise<boolean> {
    if (!platform.isExternal) {
      return this.vault().getAbstractFileByPath(directoryPath) instanceof TFolder;
    }

    try {
      return (await fs.stat(directoryPath)).isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async readPublishFile(platform: Platform, filePath: string): Promise<string> {
    if (platform.isExternal) {
      return fs.readFile(filePath, "utf8");
    }

    const file = this.vault().getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      throw new Error(`Publish file not found: ${filePath}`);
    }

    return this.vault().read(file);
  }

  private backupNoticeRoots?: Set<string>;

  async writePublishFile(platform: Platform, filePath: string, content: string, expected?: string | null): Promise<void> {
    if (platform.isExternal) {
      const backupDirectory = getPublishBackupDirectory(this.repository());
      const notified = this.backupNoticeRoots ??= new Set();
      if (expected !== null && !notified.has(backupDirectory)) {
        let message: string;
        try { message = backupGitMessage((await inspectPublishBackups(this.repository())).git); }
        catch { message = "无法检查备份目录和 Git 状态，请在设置中检查备份。"; }
        this.notify(`Hexo 覆盖前会保留全文备份，可能包含未公开内容。${message} 位置：${backupDirectory}`, 15000);
        notified.add(backupDirectory);
      }
      await writePublishedFile(filePath, content, expected,
        backupDirectory);
      return;
    }

    const file = this.vault().getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.vault().process(file, current => {
        if (expected !== undefined) assertPublishUnchanged(expected, current);
        return content;
      });
      return;
    }

    if (expected !== undefined) assertPublishUnchanged(expected, null);
    await this.vault().create(filePath, content);
  }

  async listPublishFiles(platform: Platform, directoryPath: string): Promise<string[]> {
    if (platform.isExternal) {
      const entries = await fs.readdir(directoryPath, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isFile()) files.push(fullPath);
        else if (entry.isDirectory()) files.push(...await this.listPublishFiles(platform, fullPath));
      }
      return files;
    }

    const folder = this.vault().getAbstractFileByPath(directoryPath);
    if (!(folder instanceof TFolder)) {
      throw new Error(`Publish directory not found: ${directoryPath}`);
    }

    const files: string[] = [];
    const folders = [folder];
    while (folders.length) {
      for (const child of folders.pop()!.children) {
        if (child instanceof TFile) files.push(child.path);
        else if (child instanceof TFolder) folders.push(child);
      }
    }
    return files;
  }

  async ensurePublishDirectory(platform: Platform, directoryPath: string): Promise<void> {
    if (platform.isExternal) {
      await fs.mkdir(directoryPath, { recursive: true });
      return;
    }

    const normalizedPath = normalizePath(directoryPath);
    const parts = normalizedPath.split("/").filter(Boolean);
    let currentPath = "";

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!(this.vault().getAbstractFileByPath(currentPath) instanceof TFolder)) {
        await this.vault().createFolder(currentPath);
      }
    }
  }

}
