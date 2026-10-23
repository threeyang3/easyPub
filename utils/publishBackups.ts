import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { getFrontMatterString, parseFrontMatter } from "./frontMatter";
import type { PublishBackupEntry, PublishBackupPreview } from "../types";
import { execFile } from "child_process";
import { desktopCommandEnvironment } from "./desktopEnvironment";
import { promisify } from "util";
import { getPublishBackupDirectory } from "./platforms";

const exec = promisify(execFile);
const backupName = /^[a-f0-9]{64}\.bak$/;

export async function listPublishBackups(blogPath: string): Promise<PublishBackupEntry[]> {
  const directory = getPublishBackupDirectory(blogPath);
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const result: PublishBackupEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !backupName.test(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    try {
      const stat = await fs.lstat(filePath);
      if (stat.isFile()) result.push({ name: entry.name, path: filePath, bytes: stat.size, savedAt: stat.mtimeMs });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return result.sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name));
}

export async function readPublishBackup(blogPath: string, name: string): Promise<PublishBackupPreview> {
  if (!backupName.test(name)) throw new Error("无效的备份文件名");
  const filePath = path.join(getPublishBackupDirectory(blogPath), name);
  if (!(await fs.lstat(filePath)).isFile()) throw new Error("备份不是普通文件");
  const handle = await fs.open(filePath, "r");
  // Bound reads even if an external editor grows the file while it is open.
  const limit = 2 * 1024 * 1024;
  const buffer = Buffer.alloc(limit + 1);
  let length = 0;
  try {
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
  } finally { await handle.close(); }
  if (length > limit) throw new Error("备份超过 2 MiB，请按列表中的完整路径在外部编辑器查看");
  const bytes = buffer.subarray(0, length);
  const result: PublishBackupPreview = {
    content: bytes.toString("utf8"), hashMatches: createHash("sha256").update(bytes).digest("hex") === name.slice(0, -4), metadataValid: false,
  };
  try {
    const { data } = parseFrontMatter(result.content, true);
    result.metadataValid = true;
    result.title = getFrontMatterString(data, "title");
    result.source = getFrontMatterString(data, "source_file");
    result.pubId = getFrontMatterString(data, "pub_id");
  } catch { /* Preserve raw text for manual recovery; never guess broken metadata. */ }
  return result;
}
export interface BackupStatus {
  directory: string;
  count: number;
  bytes: number;
  git: "ignored" | "tracked" | "unprotected" | "unknown";
}

// Read-only inspection: never edit ignore rules, untrack files or delete backups.
export async function inspectPublishBackups(blogPath: string): Promise<BackupStatus> {
  const directory = getPublishBackupDirectory(blogPath);
  const result: BackupStatus = { directory, count: 0, bytes: 0, git: "unknown" };
  try {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.bak$/.test(entry.name)) continue;
      const stat = await fs.lstat(`${directory}/${entry.name}`);
      if (!stat.isFile()) continue;
      result.count++;
      result.bytes += stat.size;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const options = { cwd: blogPath, env: desktopCommandEnvironment(), timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true };
  try {
    const tracked = await exec("git", ["ls-files", "-z", "--", ".easy-pub-backups"], options);
    if (tracked.stdout.length) { result.git = "tracked"; return result; }
    // Check the whole directory, not one filename that might have a special rule.
    try {
      await exec("git", ["check-ignore", "-q", "--", ".easy-pub-backups/"], options);
      result.git = "ignored";
    } catch (error) {
      if ((error as { code?: number }).code === 1) result.git = "unprotected";
    }
  } catch { /* Git missing, not a repository, timeout: protection is unknown. */ }
  return result;
}

export function backupGitMessage(status: BackupStatus["git"]): string {
  if (status === "tracked") return "备份已被 Git 跟踪；添加忽略规则不会移除已跟踪文件。请先检查暂存区与历史记录，再自行取消跟踪。";
  if (status === "ignored") return "备份目录已被 Git 忽略，当前未发现已跟踪备份；强制添加仍可能提交它们。";
  if (status === "unprotected") return "备份目录未被 Git 忽略，可能随 git add . 提交。请在博客目录的 .gitignore 中添加 .easy-pub-backups/。";
  return "无法确认 Git 忽略状态，请检查仓库与忽略规则后再提交博客。";
}
