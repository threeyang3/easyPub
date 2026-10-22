export interface PicGoUploadOptions {
  serverUrl: string;
  secret?: string;
}

export interface PicGoRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export type PicGoRequester = (
  request: PicGoRequest
) => Promise<{ status: number; json: unknown }>;

export function redactPicGoError(message: string, secret?: string): string {
  let safe = message;
  if (secret?.trim()) {
    for (const value of [secret, secret.trim(), encodeURIComponent(secret.trim())]) safe = safe.split(value).join("[已隐藏]");
  }
  return safe.replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [已隐藏]");
}

export async function uploadWithPicGo(
  filePaths: string[],
  options: PicGoUploadOptions,
  requester: PicGoRequester
): Promise<string[]> {
  if (filePaths.length === 0) {
    return [];
  }

  const uploadUrl = normalizePicGoUploadUrl(options.serverUrl);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = options.secret?.trim();
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  let response: { status: number; json: unknown };
  try {
    response = await requester({
      url: uploadUrl,
      headers,
      body: JSON.stringify({ list: filePaths }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法连接 PicGo Server：${redactPicGoError(message, secret)}`);
  }

  const data = response.json as {
    success?: boolean;
    result?: unknown;
    message?: string;
  };
  if (
    response.status < 200
    || response.status >= 300
    || data?.success !== true
  ) {
    const detail = typeof data?.message === "string" ? redactPicGoError(data.message, secret) : `HTTP ${response.status}`;
    throw new Error(`PicGo 上传失败：${detail}`);
  }
  if (
    !Array.isArray(data.result)
    || data.result.length !== filePaths.length
    || !data.result.every((url) => typeof url === "string" && /^https?:\/\//.test(url))
  ) {
    throw new Error("PicGo 返回的图片链接数量或格式不正确");
  }
  return data.result as string[];
}

export function normalizePicGoUploadUrl(serverUrl: string): string {
  const rawUrl = serverUrl.trim();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("PicGo Server 地址无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PicGo Server 地址必须使用 http 或 https");
  }
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/upload";
  }
  return url.toString();
}

export function getPicGoHeartbeatUrl(serverUrl: string): string {
  const uploadUrl = new URL(normalizePicGoUploadUrl(serverUrl));
  uploadUrl.pathname = "/heartbeat";
  uploadUrl.search = "";
  uploadUrl.hash = "";
  return uploadUrl.toString();
}
