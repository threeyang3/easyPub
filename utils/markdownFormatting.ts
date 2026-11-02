import { fromMarkdown } from "mdast-util-from-markdown";
import { parseFrontMatter } from "./frontMatter";

export interface MarkdownFormatOptions {
  indentParagraphs: boolean;
  separateParagraphs: boolean;
}

export interface MarkdownFormatResult {
  content: string;
  indentedParagraphs: number;
  addedBreaks: number;
  trimmedLines: number;
}

/** Find only top-level prose. Extension blocks and structured Markdown stay untouched. */
function proseRanges(body: string) {
  const lines = body.split(/\r?\n/);
  const tree = fromMarkdown(body);
  const protectedLines = new Set<number>();
  const codeLines = new Set<number>();
  type LiteralNode = {type:string; position?:{start:{line:number}; end:{line:number}}; children?:LiteralNode[]};
  const protectLiterals = (node: LiteralNode) => {
    if ((node.type === "code" || node.type === "html") && node.position) {
      const destination = node.type === "code" ? codeLines : protectedLines;
      for (let i = node.position.start.line - 1; i < node.position.end.line; i++) destination.add(i);
    }
    node.children?.forEach(protectLiterals);
  };
  protectLiterals(tree);
  const closingTags = new Set(Array.from(body.matchAll(/{%[-\s]*end([\w-]+)/g), match => match[1]));
  const paired = new Set(["codeblock", "blockquote", "pullquote", "raw", "note", "tabs", "tab", "gallery", "hide", "hideBlock", "fold", "mermaid"]);
  const stack: string[] = [];
  let math = false, bracketMath = false, comment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (codeLines.has(i)) { protectedLines.add(i); continue; }
    if (/^\s*\$\$/.test(line)) {
      protectedLines.add(i);
      if ((line.match(/\$\$/g)?.length ?? 0) % 2) math = !math;
    }
    if (/^\s*\\\[/.test(line)) { protectedLines.add(i); bracketMath = true; }
    if (/\\\]\s*$/.test(line)) { protectedLines.add(i); bracketMath = false; }
    if (line.includes("%%")) {
      protectedLines.add(i);
      if ((line.match(/%%/g)?.length ?? 0) % 2) comment = !comment;
    }
    const tag = /{%[-\s]*([\w-]+)/.exec(line)?.[1];
    if (tag) {
      protectedLines.add(i);
      if (tag.startsWith("end")) {
        if (stack[stack.length - 1] === tag.slice(3)) stack.pop();
      } else if (paired.has(tag) || closingTags.has(tag)) stack.push(tag);
    }
    if (stack.length || math || bracketMath || comment) protectedLines.add(i);
  }
  const ranges: Array<{start: number; end: number}> = [];
  const hardBreaks = new Set<number>();
  for (const node of tree.children) {
    if (node.type !== "paragraph" || !node.position) continue;
    const start = node.position.start.line - 1, end = node.position.end.line - 1;
    const section = lines.slice(start, end + 1);
    if (section.some((line, offset) => protectedLines.has(start + offset) || /\||<\/?[A-Za-z!]|\$\$|{%|%%/.test(line))) continue;
    // Splitting inside inline code or a link would change its syntax.
    if (node.children.some(child => child.type !== "text" && child.type !== "break"
      && child.position && child.position.start.line !== child.position.end.line)) continue;
    // Image-only paragraphs have no prose to indent or split, including Obsidian embeds.
    if (node.children.every(child => child.type === "image" || child.type === "imageReference" || child.type === "break"
      || child.type === "text" && !child.value.trim())) continue;
    if (section.every(line => /^\s*!\[\[[^\]\n]+\]\]\s*$/.test(line))) continue;
    ranges.push({start, end});
    for (const child of node.children) {
      if (child.type === "break" && child.position) hardBreaks.add(child.position.start.line - 1);
    }
  }
  return {lines, ranges, hardBreaks, protectedLines, codeLines};
}

/** Explicit local body edits: two fullwidth spaces and/or blank lines between prose lines. */
export function formatMarkdownBody(input: string, options: MarkdownFormatOptions): MarkdownFormatResult {
  const result: MarkdownFormatResult = {content: input, indentedParagraphs: 0, addedBreaks: 0, trimmedLines: 0};
  if (!options.indentParagraphs && !options.separateParagraphs) return result;
  const body = parseFrontMatter(input, true).content;
  if (!input.endsWith(body)) throw new Error("无法保留原始 Front Matter，已取消排版");
  const header = input.slice(0, input.length - body.length);
  const eol = body.includes("\r\n") || !body && input.includes("\r\n") ? "\r\n" : "\n";
  let formatted = body;
  if (options.separateParagraphs) {
    const {lines, ranges, hardBreaks, protectedLines, codeLines} = proseRanges(body);
    const prose = new Set(ranges.flatMap(({start, end}) => Array.from({length: end - start + 1}, (_, offset) => start + offset)));
    const output: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (prose.has(i)) {
        const trimmed = line.replace(/[\t ]+$/, "");
        if (trimmed !== line) result.trimmedLines++;
        line = hardBreaks.has(i) && trimmed.endsWith("\\") ? trimmed.slice(0, -1) : trimmed;
      }
      output.push(line);
      if (prose.has(i) && prose.has(i + 1) && line.trim() && lines[i + 1].trim()) {
        output.push(""); result.addedBreaks++;
      }
    }
    let tail = lines.length - 1;
    while (output.length && /^[\t ]*$/.test(output[output.length - 1])) {
      if (protectedLines.has(tail) || codeLines.has(tail)) break;
      output.pop(); tail--;
    }
    formatted = output.join(eol);
    if (formatted && !formatted.endsWith(eol)) formatted += eol;
  }
  if (options.indentParagraphs) {
    const {lines, ranges} = proseRanges(formatted);
    for (const {start} of ranges) {
      // A standalone image at the beginning of a mixed paragraph is not a prose first line.
      if (/^\s*(?:!\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^\n]*\))\s*$/.test(lines[start])) continue;
      const indented = "\u3000\u3000" + lines[start].replace(/^[\t \u3000]*/, "");
      if (indented !== lines[start]) { lines[start] = indented; result.indentedParagraphs++; }
    }
    formatted = lines.join(eol);
  }
  result.content = header + formatted;
  return result;
}
