import fs from "fs/promises";
import path from "path";
import { createHash, randomBytes } from "crypto";
import { assertPublishUnchanged } from "./publishSafety";

export async function writePublishedFile(target: string, content: string, expected?: string | null): Promise<void> {
  const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    if (expected !== undefined) {
      let current: string | null;
      try { current = await fs.readFile(target, "utf8"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        current = null;
      }
      assertPublishUnchanged(expected, current);
    }
    if (expected === null) {
      // Exclusive creation also protects against a new same-name file appearing after validation.
      await fs.link(temporary, target);
    } else {
      await fs.rename(temporary, target);
    }
  } finally { await fs.unlink(temporary).catch(() => {}); }
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
