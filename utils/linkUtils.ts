import fs from "fs/promises";
import path from "path";
import { FrontMatterData } from "../types";

export async function generateHexoUrl(
  blogPath: string,
  meta: FrontMatterData
): Promise<string | null> {
  try {
    // 读取 Hexo _config.yml
    const configPath = path.join(blogPath, "_config.yml");
    const configContent = await fs.readFile(configPath, "utf8");

    // 简单解析 permalink 格式
    const permalinkMatch = configContent.match(/permalink:\s*(.+)/);
    if (!permalinkMatch) {
      return null;
    }

    let permalink = permalinkMatch[1].trim();
    const urlMatch = configContent.match(/url:\s*(.+)/);
    const baseUrl = urlMatch ? urlMatch[1].trim() : "";

    // 替换 permalink 中的变量
    if (meta.abbrlink) {
      permalink = permalink.replace(/:abbrlink/g, String(meta.abbrlink));
    }
    if (meta.title) {
      permalink = permalink.replace(/:title/g, String(meta.title));
    }
    if (meta.date) {
      const date = new Date(meta.date as string | number | Date);
      if (!Number.isNaN(date.getTime())) {
        permalink = permalink.replace(/:year/g, date.getFullYear().toString());
        permalink = permalink.replace(/:month/g, String(date.getMonth() + 1).padStart(2, "0"));
        permalink = permalink.replace(/:day/g, String(date.getDate()).padStart(2, "0"));
      }
    }

    return baseUrl + permalink;
  } catch {
    return null;
  }
}
