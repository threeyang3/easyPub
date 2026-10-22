import { PublishDirectoryReport } from "../types";
import { getFrontMatterString, parseFrontMatter } from "./frontMatter";

export async function inspectPublishDocuments(documents: Array<{ path: string; read: () => Promise<string> }>,
  cancelled: () => boolean = () => false): Promise<PublishDirectoryReport> {
  const report: PublishDirectoryReport = { checked: 0, issues: [] };
  const ids = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const document of documents) {
    if (cancelled()) throw new Error("检查已取消");
    if (seen.has(document.path)) continue;
    seen.add(document.path);
    report.checked++;
    let content: string;
    try { content = await document.read(); }
    catch {
      report.issues.push({ kind: "unreadable", paths: [document.path], message: "无法读取，请检查文件是否存在及访问权限" });
      continue;
    }
    let data;
    try { data = parseFrontMatter(content, true).data; }
    catch {
      report.issues.push({ kind: "invalid", paths: [document.path], message: "Front Matter 无法解析，请检查元数据格式；不能排除 ID 冲突" });
      continue;
    }
    const id = getFrontMatterString(data, "pub_id");
    if (!id?.trim()) {
      report.issues.push({ kind: "missing-id", paths: [document.path], message: "未设置可用的 pub_id，可能是历史稿件；请先核对来源，不自动补齐" });
      continue;
    }
    const matches = ids.get(id) ?? [];
    matches.push(document.path);
    ids.set(id, matches);
  }
  if (cancelled()) throw new Error("检查已取消");
  for (const [id, paths] of ids) if (paths.length > 1) {
    report.issues.push({ kind: "duplicate", paths, message: `多份稿件使用同一 pub_id：${id}，请核对归属，不要直接删除原稿 ID` });
  }
  return report;
}
