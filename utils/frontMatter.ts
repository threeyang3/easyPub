import matter from "gray-matter";
import { FrontMatterData, ParsedFrontMatter } from "../types";

const SOURCE_ONLY_PUBLISHED_OMIT_FIELDS = new Set([
  "子文件",
  "source_file",
  "publish_url",
  "updated",
]);

export interface PublishedFrontMatterMergeOptions {
  sourceData: FrontMatterData;
  existingData?: FrontMatterData;
  pubId: string;
  sourceFileLink: string;
  timestamp: string;
  publishUrl?: string;
  forcePublishUrl?: boolean;
}

export function parseFrontMatter(content: string): ParsedFrontMatter {
  const result = matter(content);
  return {
    data: isFrontMatterData(result.data) ? result.data : {},
    content: result.content,
  };
}

export function stringifyFrontMatter(content: string, data: FrontMatterData): string {
  return matter.stringify(content, data);
}

export function generatePubId(): string {
  return Math.random().toString(36).substring(2, 10);
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
  sourceData,
  existingData = {},
  pubId,
  sourceFileLink,
  timestamp,
  publishUrl,
  forcePublishUrl = false,
}: PublishedFrontMatterMergeOptions): FrontMatterData {
  const publishableSourceData = getPublishableSourceFrontMatter(sourceData);
  const data: FrontMatterData = {
    ...publishableSourceData,
    ...existingData,
    pub_id: pubId,
    source_file: sourceFileLink,
    updated: timestamp,
  };

  if (hasFrontMatterValue(existingData.date)) {
    data.date = existingData.date;
  } else if (hasFrontMatterValue(publishableSourceData.date)) {
    data.date = publishableSourceData.date;
  } else {
    data.date = timestamp;
  }

  if (forcePublishUrl) {
    data.publish_url = publishUrl ?? "";
  } else if (!hasFrontMatterValue(data.publish_url)) {
    data.publish_url = publishUrl ?? "";
  }

  return data;
}

function getPublishableSourceFrontMatter(sourceData: FrontMatterData): FrontMatterData {
  return Object.fromEntries(
    Object.entries(sourceData).filter(
      ([key]) => !SOURCE_ONLY_PUBLISHED_OMIT_FIELDS.has(key)
    )
  );
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
