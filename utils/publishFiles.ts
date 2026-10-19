import fs from "fs/promises";
import path from "path";
import { createHash, randomBytes } from "crypto";
import { assertPublishUnchanged } from "./publishSafety";

export async function writePublishedFile(target: string, content: string, expected?: string | null,
  backupDirectory = path.join(path.dirname(target), ".easy-pub-backups")): Promise<void> {
  const lockPath = path.join(path.dirname(target), `.${path.basename(target)}.easy-pub.lock`);
  let lock;
  try { lock = await fs.open(lockPath, "wx"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`目标正在发布，或上次异常退出留下锁文件。请确认没有发布任务后再移除锁文件并重新发布：${lockPath}`);
    }
    throw error;
  }
  const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  const readCurrent = async (): Promise<string | null> => {
    try { return await fs.readFile(target, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return null;
    }
  };
  try {
    const current = await readCurrent();
    if (expected !== undefined) assertPublishUnchanged(expected, current);
    if (current !== null) {
      // Keep recoverable versions outside Hexo's source tree in production.
      const hash = createHash("sha256").update(current).digest("hex");
      const backup = path.join(backupDirectory, `${hash}.bak`);
      await fs.mkdir(backupDirectory, { recursive: true });
      let handle;
      try { handle = await fs.open(backup, "wx"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await fs.readFile(backup, "utf8") !== current) throw new Error(`发布备份损坏，请检查：${backup}`);
      }
      if (handle) {
        try { await handle.writeFile(current, "utf8"); await handle.sync(); }
        finally { await handle.close(); }
      }
    }
    await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    assertPublishUnchanged(current, await readCurrent());
    if (current === null) {
      // Exclusive creation also protects against a new same-name file appearing after validation.
      await fs.link(temporary, target);
    } else {
      await fs.rename(temporary, target);
    }
  } finally {
    await fs.unlink(temporary).catch(() => {});
    // Cleanup must not turn a committed write into an apparent write failure,
    // or replace the original error. A leftover lock safely blocks the next run.
    try {
      await lock.close();
      await fs.unlink(lockPath);
    } catch (error) {
      console.warn(`EasyPub could not remove publish lock: ${lockPath}`, error);
    }
  }
}

// Publish complete bytes exclusively; never replace an existing content-addressed asset.
export async function writeImmutableAsset(target: string, bytes: Uint8Array, hash: string): Promise<boolean> {
  if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error("图片在确认期间发生变化，请重新发布");
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { flag: "wx" });
    try {
      await fs.link(temporary, target);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (createHash("sha256").update(await fs.readFile(target)).digest("hex") !== hash) {
        throw new Error("图片目标内容不一致，请检查博客素材");
      }
      return false;
    }
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}
