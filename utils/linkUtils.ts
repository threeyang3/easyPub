import fs from "fs/promises";
import path from "path";
import { FrontMatterData } from "../types";

export async function generateHexoUrl(
  blogPath: string,
  meta: FrontMatterData,
  targetPath: string
): Promise<string | null> {
  try {
    const configContent = await fs.readFile(path.join(blogPath, "_config.yml"), "utf8");
    const configuredUrl = getTopLevelYamlScalar(configContent, "url");
    if (!configuredUrl) {
      return null;
    }

    const siteUrl = new URL(configuredUrl);
    if (siteUrl.protocol !== "http:" && siteUrl.protocol !== "https:") {
      return null;
    }

    const configuredRoot = getTopLevelYamlScalar(configContent, "root");
    const root = normalizeRoot(configuredRoot ?? siteUrl.pathname);
    const filenameCase = Number(getTopLevelYamlScalar(configContent, "filename_case") ?? "0");
    const postNames = getPostNames(blogPath, targetPath, filenameCase);
    if (!postNames) {
      return null;
    }

    const frontMatterPermalink = typeof meta.permalink === "string"
      ? meta.permalink.trim()
      : "";
    let permalink = frontMatterPermalink
      || getTopLevelYamlScalar(configContent, "permalink")
      || ":year/:month/:day/:title/";

    permalink = replaceToken(permalink, "title", postNames.title);
    permalink = replaceToken(permalink, "name", postNames.name);

    if (meta.title !== undefined) {
      permalink = replaceToken(
        permalink,
        "post_title",
        encodePathSegment(slugize(String(meta.title), filenameCase))
      );
    }
    if (meta.abbrlink !== undefined) {
      permalink = replaceToken(permalink, "abbrlink", encodePathSegment(String(meta.abbrlink)));
    }

    const categoryPath = getCategoryPath(meta.categories, filenameCase);
    if (categoryPath) {
      permalink = replaceToken(permalink, "category", categoryPath);
    }

    if (meta.date !== undefined) {
      const dateTokens = getDateTokens(
        meta.date,
        getTopLevelYamlScalar(configContent, "timezone")
      );
      if (!dateTokens) {
        return null;
      }
      for (const [token, value] of Object.entries(dateTokens)) {
        permalink = replaceToken(permalink, token, value);
      }
    }

    if (/:[a-z_]+/i.test(permalink)) {
      return null;
    }

    return `${siteUrl.origin}${root}${permalink.replace(/^\/+/, "")}`;
  } catch {
    return null;
  }
}

export async function getHexoRootPath(blogPath: string): Promise<string> {
  const configContent = await fs.readFile(path.join(blogPath, "_config.yml"), "utf8");
  const configuredRoot = getTopLevelYamlScalar(configContent, "root");
  if (configuredRoot) {
    return normalizeRoot(configuredRoot);
  }
  const configuredUrl = getTopLevelYamlScalar(configContent, "url");
  if (!configuredUrl) {
    return "/";
  }
  try {
    return normalizeRoot(new URL(configuredUrl).pathname);
  } catch {
    return "/";
  }
}

function getPostNames(
  blogPath: string,
  targetPath: string,
  filenameCase: number
): { title: string; name: string } | null {
  const postsDirectory = path.resolve(blogPath, "source", "_posts");
  const relativePath = path.relative(postsDirectory, path.resolve(targetPath));
  if (
    !relativePath
    || relativePath === ".."
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
  ) {
    return null;
  }

  const extension = path.extname(relativePath);
  const withoutExtension = relativePath.slice(0, relativePath.length - extension.length);
  const relativeSegments = withoutExtension.split(/[\\/]/).map(
    (segment) => encodePathSegment(slugize(segment, filenameCase))
  );
  return {
    title: relativeSegments.join("/"),
    name: relativeSegments[relativeSegments.length - 1],
  };
}

function getCategoryPath(categories: unknown, filenameCase: number): string | null {
  if (!Array.isArray(categories) || categories.length === 0) {
    return null;
  }
  const hierarchy = Array.isArray(categories[0]) ? categories[0] : categories;
  const segments = hierarchy
    .filter((category): category is string | number => (
      typeof category === "string" || typeof category === "number"
    ))
    .map((category) => encodePathSegment(slugize(String(category), filenameCase)));
  return segments.length > 0 ? segments.join("/") : null;
}

function getDateTokens(
  value: unknown,
  timezone: string | null
): Record<string, string> | null {
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  if (timezone) {
    options.timeZone = timezone;
  }

  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", options)
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );
    return {
      year: parts.year,
      month: parts.month,
      i_month: String(Number(parts.month)),
      day: parts.day,
      i_day: String(Number(parts.day)),
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
      timestamp: String(Math.floor(date.getTime() / 1000)),
    };
  } catch {
    return null;
  }
}

function replaceToken(permalink: string, token: string, value: string): string {
  return permalink.replace(new RegExp(`:${escapeRegExp(token)}\\b`, "g"), value);
}

function slugize(value: string, filenameCase: number): string {
  const normalized = value.trim().replace(/\s+/g, "-");
  if (filenameCase === 1) {
    return normalized.toLowerCase();
  }
  if (filenameCase === 2) {
    return normalized.toUpperCase();
  }
  return normalized;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function getTopLevelYamlScalar(content: string, key: string): string | null {
  const keyPattern = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*(.*)$`);
  for (const line of content.split(/\r?\n/)) {
    if (/^\s/.test(line)) {
      continue;
    }
    const match = line.match(keyPattern);
    if (!match) {
      continue;
    }
    const value = stripYamlComment(match[1]).trim();
    if (!value) {
      return null;
    }
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
    return value;
  }
  return null;
}

function stripYamlComment(value: string): string {
  let quote: "'" | "\"" | null = null;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if ((character === "'" || character === "\"") && value[index - 1] !== "\\") {
      quote = quote === character ? null : quote ?? character;
    } else if (character === "#" && quote === null) {
      return value.slice(0, index);
    }
  }
  return value;
}

function normalizeRoot(root: string): string {
  const normalized = root.replace(/^\/+|\/+$/g, "");
  return normalized ? `/${normalized}/` : "/";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
