import type { App } from "obsidian";
import type { WechatPreparedDocument } from "../types";
import { readWechatImage } from "./wechatImages";
import { wechatHash } from "./wechatHash";

/** A metadata save can reuse decoded local body images only after byte validation.
 * Remote images always require the ordinary renderer. Sync independently rechecks
 * originals even when this optimization succeeds. Ownership stays with the view. */
export async function canReuseWechatPreview(app: App, prepared: WechatPreparedDocument,
  filePath: string, allowRemote: () => boolean): Promise<boolean> {
  if (prepared.issues.length || prepared.images.some(image => !image.localPath)) return false;
  try {
    for (const image of prepared.images) {
      const raw = await readWechatImage(app, image.source, filePath, undefined, allowRemote);
      if (raw.localPath !== image.localPath || wechatHash(raw.bytes) !== image.originalHash) return false;
    }
    return true;
  } catch { return false; }
}
