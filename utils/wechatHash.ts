import { createHash } from "crypto";

export const wechatHash = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
