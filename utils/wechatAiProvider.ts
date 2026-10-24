import { requestUrl } from "obsidian";
import { WechatAiSettings } from "../types";
import { withTimeout } from "./async";

export function validateAiEndpoint(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("请填写完整的 AI 接口地址"); }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash
    || !url.pathname.endsWith("/chat/completions")) throw new Error("AI 接口须为 HTTPS 的 /chat/completions 地址；本机模型可使用回环 HTTP 地址，不允许网址中的凭据或查询参数");
  return url.href;
}
export function normalizeAiSettings(value: unknown): WechatAiSettings {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { endpoint: typeof data.endpoint === "string" ? data.endpoint : "", model: typeof data.model === "string" ? data.model : "",
    encryptedKey: typeof data.encryptedKey === "string" ? data.encryptedKey : "", jsonMode: data.jsonMode !== false };
}
export interface AiTransportRequest {url: string; method: "POST"; headers: Record<string, string>; body: string; throw: false}
export type AiTransport = (request: AiTransportRequest) => Promise<{status: number; arrayBuffer: ArrayBuffer}>;
export async function requestWechatPlan(settings: WechatAiSettings, apiKey: string, messages: Array<{role: string; content: string}>,
  transport: AiTransport = requestUrl, timeout = 45000): Promise<string> {
  const url = validateAiEndpoint(settings.endpoint);
  if (!settings.model.trim() || settings.model.length > 200 || /[\r\n]/.test(settings.model)) throw new Error("请填写有效的模型名称");
  if (/[\r\n]/.test(apiKey)) throw new Error("API Key 格式无效");
  if (new TextEncoder().encode(JSON.stringify(messages)).length > 64 * 1024) throw new Error("排版请求超过 64 KB，请分篇处理");
  let response: Awaited<ReturnType<AiTransport>>;
  try {
    response = await withTimeout(transport({url, method: "POST", throw: false,
      headers: {"Content-Type": "application/json", ...(apiKey ? {Authorization: `Bearer ${apiKey}`} : {})},
      body: JSON.stringify({ model: settings.model, messages, stream: false, max_tokens: 4096,
        ...(settings.jsonMode ? {response_format: {type: "json_object"}} : {}) }),
    }), timeout, "AI 请求超时");
  } catch { throw new Error("AI 请求超时或连接失败；当前排版未被修改，可稍后重试"); }
  if (response.status < 200 || response.status >= 300) throw new Error(`AI 服务返回 HTTP ${response.status}，请检查地址、模型、认证和额度`);
  // requestUrl buffers the response; cap it before parsing or retaining any model output.
  if (response.arrayBuffer.byteLength > 256 * 1024) throw new Error("AI 响应超过 256 KB，已丢弃");
  try {
    const data = JSON.parse(new TextDecoder().decode(response.arrayBuffer));
    const choice = data.choices?.[0];
    if (choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string" || choice.message.content.length > 48000) throw new Error();
    return choice.message.content;
  } catch { throw new Error("AI 未返回完整的排版 JSON，已丢弃；当前排版未被修改"); }
}
