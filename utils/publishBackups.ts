import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { getPublishBackupDirectory } from "./platforms";

const exec = promisify(execFile);
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
  const options = { cwd: blogPath, timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true };
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
