import { parseFrontMatter } from "./frontMatter";
import { fromMarkdown } from "mdast-util-from-markdown";

export interface HexoFormatResult { content: string; addedBreaks: number; trimmedLines: number }

/** Only standalone prose is reformatted. Preserve structured Markdown and Hexo blocks byte-for-byte. */
export function formatHexoMarkdown(input: string): HexoFormatResult {
  const eol = input.includes("\r\n") ? "\r\n" : "\n";
  // Use the same parser as publishing: hand-written delimiter regexes miss
  // valid headers such as an empty mapping or a closing marker with spaces.
  const body = parseFrontMatter(input, true).content;
  if (!input.endsWith(body)) throw new Error("无法保留原始 Front Matter，已取消排版");
  const header = input.slice(0, input.length - body.length);
  const lines = body.split(/\r?\n/);
  const protectedLines = new Set<number>();
  const tree = fromMarkdown(body);
  const codeLines = new Set<number>();
  for (const node of tree.children) {
    if (node.type === "code" && node.position) {
      for (let i = node.position.start.line - 1; i < node.position.end.line; i++) codeLines.add(i);
    }
  }
  const closingTags = new Set(Array.from(body.matchAll(/{%[-\s]*end([\w-]+)/g), match => match[1]));
  // Hexo paired tags, math and Obsidian comments are outside CommonMark's grammar.
  const stack: string[] = [];
  let math = false, comment = false;
  const paired = new Set(["codeblock", "blockquote", "pullquote", "raw", "note", "tabs", "tab", "gallery", "hide", "hideBlock", "fold", "mermaid"]);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (codeLines.has(i)) { protectedLines.add(i); continue; }
    if (/^\s*\$\$/.test(line)) { protectedLines.add(i); if ((line.match(/\$\$/g)?.length ?? 0) % 2) math = !math; }
    if (line.includes("%%")) { protectedLines.add(i); if ((line.match(/%%/g)?.length ?? 0) % 2) comment = !comment; }
    const tag = /{%[-\s]*([\w-]+)/.exec(line)?.[1];
    if (tag) {
      protectedLines.add(i);
      if (tag.startsWith("end")) { if (stack[stack.length - 1] === tag.slice(3)) stack.pop(); }
      else if (paired.has(tag) || closingTags.has(tag)) stack.push(tag);
    }
    if (stack.length || math || comment) protectedLines.add(i);
  }
  const prose = new Set<number>();
  const hardBreaks = new Set<number>();
  for (const node of tree.children) {
    if (node.type !== "paragraph" || !node.position) continue;
    const start = node.position.start.line - 1, end = node.position.end.line - 1;
    const section = lines.slice(start, end + 1);
    // A line break inside a code span or link is syntax, not a prose boundary.
    if (node.children.some(child => child.type !== "text" && child.type !== "break"
      && child.position && child.position.start.line !== child.position.end.line)) continue;
    // GFM tables, math, HTML and custom directives may parse as ordinary paragraphs.
    if (section.some((line, offset) => protectedLines.has(start + offset) || /\||<\/?[A-Za-z!]|\$\$|{%|%%/.test(line))) continue;
    for (const child of node.children) if (child.type === "break" && child.position) hardBreaks.add(child.position.start.line - 1);
    for (let i = start; i <= end; i++) prose.add(i);
  }
  let addedBreaks = 0, trimmedLines = 0;
  const output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (prose.has(i)) {
      const trimmed = line.replace(/[\t ]+$/, "");
      if (trimmed !== line) trimmedLines++;
      line = hardBreaks.has(i) && trimmed.endsWith("\\") ? trimmed.slice(0, -1) : trimmed;
    }
    output.push(line);
    if (prose.has(i) && prose.has(i + 1) && line.trim() && lines[i + 1].trim()) {
      output.push(""); addedBreaks++;
    }
  }
  // Keep a single terminating newline. Do not trim code or other structured lines.
  let tail = lines.length - 1;
  while (output.length && /^[\t ]*$/.test(output[output.length - 1])) {
    if (protectedLines.has(tail) || codeLines.has(tail)) break;
    output.pop(); tail--;
  }
  const formatted = output.join(eol);
  return { content: header + (formatted && !formatted.endsWith(eol) ? formatted + eol : formatted), addedBreaks, trimmedLines };
}
