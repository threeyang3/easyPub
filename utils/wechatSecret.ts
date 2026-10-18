interface SafeStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
function storage(): SafeStorage | undefined {
  try {
    const electron = require("electron") as { safeStorage?: SafeStorage; remote?: { safeStorage?: SafeStorage } };
    const safe = electron.safeStorage ?? electron.remote?.safeStorage;
    if (safe?.isEncryptionAvailable() && safe.getSelectedStorageBackend?.() !== "basic_text") return safe;
  } catch { /* Session-only credentials are supported on older Electron versions. */ }
  return undefined;
}
export function encryptWechatSecret(secret: string): string {
  try { return secret ? storage()?.encryptString(secret).toString("base64") ?? "" : ""; }
  catch { return ""; }
}
export function decryptWechatSecret(ciphertext: string): string {
  if (!ciphertext) return "";
  try { return storage()?.decryptString(Buffer.from(ciphertext, "base64")) ?? ""; }
  catch { return ""; }
}
