// Readback is a separate diagnostic step; it must never retry a successful write.
export function compareWechatReadback(expected: string, actual: string): string[] {
  const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
  const local = parse(expected), remote = parse(actual);
  local.querySelectorAll("script,style").forEach(el => el.remove());
  remote.querySelectorAll("script,style").forEach(el => el.remove());
  const warnings: string[] = [];
  const text = (doc: Document) => doc.body.textContent?.replace(/\s+/g, " ").trim();
  const content = (doc: Document) => Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p,ul,ol,li,blockquote,pre,table,tr,td,th"))
    .map(el => [el.tagName, el.textContent, el.getAttribute("start"), el.getAttribute("rowspan"), el.getAttribute("colspan")]);
  if (text(local) !== text(remote) || JSON.stringify(content(local)) !== JSON.stringify(content(remote))) warnings.push("微信回读的正文结构或文字与本地排版不同，请在后台逐段核对");
  const images = (doc: Document) => Array.from(doc.querySelectorAll("img")).map(el => [wechatImageIdentity(el.getAttribute("data-src") || el.getAttribute("src") || ""), el.getAttribute("alt") ?? ""]);
  if (JSON.stringify(images(local)) !== JSON.stringify(images(remote))) warnings.push("微信回读的图片或顺序与本地排版不同，请在后台核对");
  const hrefs = Array.from(remote.querySelectorAll("a")).map(el => el.getAttribute("href"));
  let missing = 0;
  for (const el of Array.from(local.querySelectorAll("a"))) {
    const index = hrefs.indexOf(el.getAttribute("href"));
    if (index >= 0) hrefs.splice(index, 1); else missing++;
  }
  if (missing) warnings.push(`微信移除或改写了 ${missing} 处链接，请在后台核对链接；链接文字可能仍保留`);
  return warnings;
}

export function wechatImageIdentity(value: string): string {
  try {
    const url = new URL(value);
    // WeChat converts uploadimg's HTTP original (/0) to a resized HTTPS
    // rendition (/640), stored in data-src. Keep the actual asset ID and all
    // unknown query parameters so different images cannot compare equal.
    const match = /^\/mmbiz_(?:jpg|png|gif|webp)\/[a-zA-Z0-9_-]+\/(?:0|[1-9]\d{0,3})$/.exec(url.pathname);
    if (["http:", "https:"].includes(url.protocol) && url.hostname === "mmbiz.qpic.cn" && !url.port && !url.username && !url.password && match) {
      url.protocol = "https:";
      url.pathname = url.pathname.replace(/\/\d+$/, "/0");
      for (const key of ["from", "wx_fmt"]) url.searchParams.delete(key);
      url.searchParams.sort();
    }
    return url.href;
  } catch { return value; }
}
