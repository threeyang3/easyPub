import { PluginSettings } from "../types";
import { encryptWechatSecret, decryptWechatSecret } from "./wechatSecret";

// The plaintext field is retained in memory for legacy callers, never serialized.
export function restorePicGoSecret(settings: PluginSettings, decrypt = decryptWechatSecret): void {
  if (!settings.picgoServerSecret) settings.picgoServerSecret = decrypt(settings.picgoEncryptedSecret);
}

export function serializePicGoSettings(settings: PluginSettings, encrypt = encryptWechatSecret): PluginSettings {
  return {
    ...settings,
    picgoServerSecret: "",
    // Preserve unreadable ciphertext when saving unrelated settings on another machine.
    picgoEncryptedSecret: settings.picgoServerSecret
      ? (settings.imageHandling !== "picgo" && settings.picgoEncryptedSecret)
        || encrypt(settings.picgoServerSecret) || settings.picgoEncryptedSecret
      : settings.picgoEncryptedSecret,
  };
}
