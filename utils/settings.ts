import { DEFAULT_SETTINGS, PluginSettings } from "../types";
import { createHash } from "crypto";
import { normalizeWechatSettings } from "./wechatState";

export function normalizeSettings(value: unknown): PluginSettings {
  const saved = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const text = (key: keyof PluginSettings): string => typeof saved[key] === "string"
    ? (saved[key] as string).trim() : String(DEFAULT_SETTINGS[key]);
  const settings: PluginSettings = {
    hexoRepoPath: text("hexoRepoPath"),
    publishBasePath: text("publishBasePath") || DEFAULT_SETTINGS.publishBasePath,
    autoDeploy: saved.autoDeploy === true,
    imageHandling: saved.imageHandling === "picgo" ? "picgo" : "local",
    picgoServerUrl: text("picgoServerUrl") || DEFAULT_SETTINGS.picgoServerUrl,
    picgoServerSecret: text("picgoServerSecret"),
    picgoImageCache: {},
    wechat: normalizeWechatSettings(saved.wechat),
  };
  if (saved.picgoImageCache && typeof saved.picgoImageCache === "object") {
    for (const [key, value] of Object.entries(saved.picgoImageCache)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      if (typeof entry.hash === "string" && /^[a-f0-9]{64}$/.test(entry.hash)
        && typeof entry.url === "string" && /^https?:\/\//.test(entry.url)) {
        Object.defineProperty(settings.picgoImageCache, key, {
          value: { hash: entry.hash, url: entry.url }, enumerable: true, writable: true, configurable: true,
        });
      }
    }
  }
  return settings;
}

export function publishSettingsFingerprint(settings: PluginSettings): string {
  const { picgoImageCache, wechat, ...configuration } = settings;
  return createHash("sha256").update(JSON.stringify(configuration)).digest("hex");
}
