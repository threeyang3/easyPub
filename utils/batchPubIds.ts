import fs from "fs/promises";
import path from "path";
import { generatePubId, parseFrontMatter, stringifyFrontMatter } from "./frontMatter";
import { writePublishedFile } from "./publishFiles";

export function needsPubId(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

export interface PubIdDocument {
  path: string;
  read(): Promise<string>;
  // Implementations must recheck current metadata/content before writing.
  assign(id: string, expected: string): Promise<boolean>;
}

export interface PubIdBatchResult {
  added: number;
  skipped: number;
  failures: Array<{ path: string; message: string }>;
}

export async function fillMissingPubIds(documents: PubIdDocument[]): Promise<PubIdBatchResult> {
  const result: PubIdBatchResult = { added: 0, skipped: 0, failures: [] };
  const candidates: Array<{ document: PubIdDocument; content: string }> = [];
  const reserved = new Set<string>();
  for (const document of documents) {
    try {
      const content = await document.read();
      const { data } = parseFrontMatter(content, true);
      if (needsPubId(data.pub_id)) candidates.push({ document, content });
      else { reserved.add(String(data.pub_id)); result.skipped++; }
    } catch (error) {
      result.failures.push({ path: document.path, message: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const { document, content } of candidates) {
    try {
      let id: string;
      do { id = generatePubId(); } while (reserved.has(id));
      reserved.add(id);
      if (await document.assign(id, content)) result.added++;
      else result.skipped++;
    } catch (error) {
      result.failures.push({ path: document.path, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export async function externalPubIdDocuments(root: string): Promise<PubIdDocument[]> {
  if (!path.isAbsolute(root)) throw new Error("外部文件夹必须使用绝对路径");
  if (!(await fs.lstat(root)).isDirectory()) throw new Error("请选择文件夹，不能使用文件或符号链接");
  const documents: PubIdDocument[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filePath);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
        documents.push({
          path: filePath,
          read: () => fs.readFile(filePath, "utf8"),
          assign: async (id, expected) => {
            const parsed = parseFrontMatter(expected, true);
            await writePublishedFile(filePath, stringifyFrontMatter(parsed.content, { ...parsed.data, pub_id: id }), expected);
            return true;
          },
        });
      }
    }
  }
  await visit(root);
  return documents;
}
