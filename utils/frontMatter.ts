import matter from "gray-matter";
import { randomBytes } from "crypto";
import { FrontMatterData, ParsedFrontMatter } from "../types";
import { canonicalWechatTitle, initialPlatformProperties } from "./articleProperties";

export interface PublishedFrontMatterMergeOptions {
  platformId: string;
  title?: string;
  defaultAuthor?: string;
  sourceData: FrontMatterData;
  existingData?: FrontMatterData;
  pubId: string;
  sourceFileLink: string;
  timestamp: string;
  publishUrl?: string;
  forcePublishUrl?: boolean;
}

export function parseFrontMatter(content: string, requireMapping = false): ParsedFrontMatter {
  const rejectExecutable = () => { throw new Error("不支持可执行的 JavaScript Front Matter，请使用 YAML 或 JSON"); };
  const result = matter(content, { engines: { javascript: rejectExecutable, js: rejectExecutable } });
  if (requireMapping && !isFrontMatterData(result.data)) throw new Error("Front Matter 必须是键值对象");
  return {
    data: isFrontMatterData(result.data) ? result.data : {},
    content: result.content,
  };
}

export function stringifyFrontMatter(content: string, data: FrontMatterData): string {
  // This is already the body: do not parse a leading horizontal rule or code
  // example as a second front-matter block (or execute a language engine).
  return matter.stringify({ content }, data);
}

export function parseYamlDocument(content: string): FrontMatterData {
  // A distinct delimiter keeps YAML document markers inside the parser input.
  const delimiter = `easy-pub-${randomBytes(16).toString("hex")}`;
  const result = matter(`${delimiter}\n${content}\n${delimiter}`, { delimiters: delimiter });
  if (!isFrontMatterData(result.data)) throw new Error("YAML 配置必须是键值对象");
  return result.data;
}

export function generatePubId(): string {
  return randomBytes(8).toString("hex");
}

export function getFrontMatterString(
  data: FrontMatterData,
  key: string
): string | undefined {
  const value = data[key];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

export function normalizeChildReferences(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeChildReference(entry))
      .filter((entry): entry is string => Boolean(entry));
  }

  const reference = normalizeChildReference(value);
  return reference ? [reference] : [];
}

export function mergeSourceFrontMatter(
  sourceData: FrontMatterData,
  pubId: string,
  childReference: string,
  obsoleteChildReferences: string[] = []
): FrontMatterData {
  const data: FrontMatterData = { ...sourceData, pub_id: pubId };
  delete data.source_file;
  delete data.publish_url;
  delete data.updated;
  const childReferences = normalizeChildReferences(data.子文件).filter(
    (reference) => !obsoleteChildReferences.includes(reference)
  );

  if (!childReferences.includes(childReference)) {
    childReferences.push(childReference);
  }

  data.子文件 = childReferences;
  return data;
}

export function mergePublishedFrontMatter({
  platformId,
  title = "Untitled",
  defaultAuthor = "",
  sourceData,
  existingData,
  pubId,
  sourceFileLink,
  timestamp,
  publishUrl,
  forcePublishUrl = false,
}: PublishedFrontMatterMergeOptions): FrontMatterData {
  const properties = existingData === undefined
    ? initialPlatformProperties(platformId, sourceData, title, defaultAuthor)
    : platformId === "wechat" ? canonicalWechatTitle(existingData) : existingData;
  const data: FrontMatterData = {
    ...properties,
    pub_id: pubId,
    source_file: sourceFileLink,
    updated: timestamp,
  };

  if (hasFrontMatterValue(existingData?.date)) {
    data.date = existingData!.date;
  } else if (hasFrontMatterValue(sourceData.date)) {
    data.date = sourceData.date;
  } else {
    data.date = timestamp;
  }

  if (forcePublishUrl) {
    data.publish_url = publishUrl ?? "";
  } else if (publishUrl !== undefined) {
    data.publish_url = publishUrl;
  }

  return data;
}

function normalizeChildReference(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const reference = String(value).trim();
  return reference || null;
}

function hasFrontMatterValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function isFrontMatterData(value: unknown): value is FrontMatterData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
