export interface WechatComparison { label: string; local: string; remote: string }

// Parse inert HTML only; never insert remote markup into the live document.
export function wechatReadableHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object").forEach(el => el.remove());
  doc.querySelectorAll("img").forEach(el => el.replaceWith(doc.createTextNode(`[图片：${el.getAttribute("alt") || "无说明"}]`)));
  doc.querySelectorAll("br").forEach(el => el.replaceWith(doc.createTextNode("\n")));
  doc.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,tr,pre,blockquote").forEach(el => el.appendChild(doc.createTextNode("\n")));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

// Linear-time bounded highlighting: preserve common context and mark the changed
// span. Unlike an LCS matrix, this remains responsive for long articles.
export function changedSpan(value: string, other: string): [string, string, string] {
  const a = Array.from(value), b = Array.from(other);
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return [a.slice(0, start).join(""), a.slice(start, a.length - end).join(""), a.slice(a.length - end).join("")];
}

export function renderWechatComparison(parent: HTMLElement, rows: WechatComparison[]) {
  parent.createEl("p", { text: "左侧为待同步本地内容，右侧为当前微信草稿。高亮部分表示两者不同；原始内容可展开核对。" });
  for (const row of rows) {
    const section = parent.createEl("details", { cls: "epw-comparison" });
    section.open = row.local !== row.remote;
    section.createEl("summary", { text: `${row.label} · ${row.local === row.remote ? "相同" : "有差异"}` });
    const grid = section.createDiv({ cls: "epw-comparison-grid" });
    for (const [label, value, other] of [["本地成稿", row.local, row.remote], ["微信草稿", row.remote, row.local]]) {
      const cell = grid.createDiv(); cell.createEl("strong", { text: label });
      const pre = cell.createEl("pre");
      const [before, changed, after] = changedSpan(value, other);
      pre.appendChild(document.createTextNode(before));
      if (changed) pre.createEl("mark", { text: changed });
      pre.appendChild(document.createTextNode(after));
      if (!value) pre.createEl("span", { text: "（空）" });
    }
  }
}
