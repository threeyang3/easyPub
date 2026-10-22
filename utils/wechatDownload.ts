// Keep Chromium's proxy support; never fall back to an unbounded requestUrl read.
type Events = { on(event: string, callback: (...args: any[]) => void): any };
export type ImageRequest = Events & { end(): void; abort(): void };
export type ImageRequester = (options: Record<string, unknown>) => ImageRequest;
export const WECHAT_DOWNLOAD_LIMIT = 20 * 1024 * 1024;

export function validateImageDownloadUrl(source: string): URL {
  const url = new URL(source);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('图片仅支持不含账号密码的 HTTP(S) 地址');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.')) {
    // IPv6 is handled separately below.
    if (!host.startsWith('[')) throw new Error('不允许下载本机或内网地址图片，请改用 Vault 附件');
  }
  if (host.startsWith('[')) {
    // URL has already validated and canonicalized IPv6. Check numeric prefixes,
    // not the entire 2001::/16 (which contains ordinary public allocations).
    const [first, second = '0'] = host.slice(1, -1).split(':');
    const a = parseInt(first || '0', 16), b = parseInt(second || '0', 16);
    // Policy: ordinary 2000::/3 only; exclude IETF protocol assignments /23,
    // documentation prefixes and 6to4. This is a URL filter, not DNS protection.
    if ((a & 0xe000) !== 0x2000 || a === 0x2001 && (b < 0x200 || b === 0xdb8)
      || a === 0x2002 || a === 0x3fff && b < 0x1000) throw new Error('不允许下载特殊 IPv6 地址图片');
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254
      || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0)
      || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19)) {
      throw new Error('不允许下载本机或内网地址图片，请改用 Vault 附件');
    }
  }
  return url;
}

function electronRequester(options: Record<string, unknown>): ImageRequest {
  const electron = require('electron');
  const net = electron.net ?? electron.remote?.net;
  if (!net?.request) throw new Error('当前宿主不支持安全的流式下载，请将图片保存为 Vault 附件');
  return net.request(options);
}

export function downloadWechatImage(source: string, requester: ImageRequester = electronRequester,
  limit = WECHAT_DOWNLOAD_LIMIT, timeoutMs = 15000): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let active: ImageRequest | undefined;
    let settled = false;
    let redirects = 0;
    const chunks: Uint8Array[] = [];
    let size = 0;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { chunks.length = 0; try { active?.abort(); } catch {} reject(error); }
      else {
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        chunks.length = 0;
        resolve(bytes);
      }
    };
    const timer = setTimeout(() => finish(new Error('下载图片超时，已中止请求')), timeoutMs);
    const start = (source: string) => {
      try {
        const url = validateImageDownloadUrl(source);
        const request = requester({ url: url.href, method: 'GET', redirect: 'manual', credentials: 'omit', useSessionCookies: false });
        active = request;
        const current = () => !settled && active === request;
        request.on('error', () => { if (current()) finish(new Error('图片下载网络错误')); });
        request.on('redirect', (_status: number, _method: string, destination: string) => {
          if (!current()) return;
          try {
            const next = validateImageDownloadUrl(new URL(destination, url).href);
            if (++redirects > 5) throw new Error('图片重定向次数过多');
            if (url.protocol === 'https:' && next.protocol !== 'https:') throw new Error('拒绝图片 HTTPS 降级重定向');
            active = undefined;
            request.abort();
            start(next.href);
          } catch (error) { finish(error as Error); }
        });
        request.on('response', (response: Events & { statusCode: number; headers: Record<string, string | string[]> }) => {
          if (!current()) return;
          response.on('error', () => { if (current()) finish(new Error('图片响应中断')); });
          response.on('aborted', () => { if (current()) finish(new Error('图片响应中断')); });
          const length = Number(response.headers['content-length']);
          if (response.statusCode !== 200) { finish(new Error(`下载失败 HTTP ${response.statusCode}`)); return; }
          if (length > limit) { finish(new Error('原图超过 20 MB，请先缩小或替换')); return; }
          // Register completion before data starts flowing, especially through
          // Obsidian's remote bridge where a cached response can finish at once.
          response.on('end', () => { if (current()) finish(); });
          response.on('data', (chunk: Uint8Array) => {
            if (!current()) return;
            if (chunk.length > limit - size) { finish(new Error('原图超过 20 MB，请先缩小或替换')); return; }
            size += chunk.length;
            chunks.push(new Uint8Array(chunk));
          });
        });
        request.end();
      } catch (error) { finish(error as Error); }
    };
    start(source);
  });
}
