import { PublishAsset } from "../types";

export interface ResolvedImage {
  url: string;
  alt: string;
  asset?: PublishAsset;
}

export interface PreparedImageContent {
  content: string;
  assets: PublishAsset[];
}

export async function prepareImageEmbeds(
  content: string,
  resolveImage: (linkPath: string) => Promise<ResolvedImage | null>
): Promise<PreparedImageContent> {
  const assets = new Map<string, PublishAsset>();
  const lines = content.match(/[^\r\n]*(?:\r\n|\n|$)/g) ?? [content];
  let fenceCharacter: "`" | "~" | null = null;
  let fenceLength = 0;

  const transformedLines: string[] = [];
  for (const line of lines) {
    if (line === "") {
      continue;
    }
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const character = marker[0] as "`" | "~";
      if (fenceCharacter === null) {
        fenceCharacter = character;
        fenceLength = marker.length;
      } else if (character === fenceCharacter && marker.length >= fenceLength) {
        fenceCharacter = null;
        fenceLength = 0;
      }
      transformedLines.push(line);
      continue;
    }

    if (fenceCharacter !== null) {
      transformedLines.push(line);
      continue;
    }

    transformedLines.push(await transformLine(line, resolveImage, assets));
  }

  return {
    content: transformedLines.join(""),
    assets: [...assets.values()],
  };
}

async function transformLine(
  line: string,
  resolveImage: (linkPath: string) => Promise<ResolvedImage | null>,
  assets: Map<string, PublishAsset>
): Promise<string> {
  const embedPattern = /!\[\[([^\]\r\n]+)\]\]/g;
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = embedPattern.exec(line)) !== null) {
    result += line.slice(lastIndex, match.index);
    if (isInsideInlineCode(line, match.index)) {
      result += match[0];
      lastIndex = embedPattern.lastIndex;
      continue;
    }

    const linkPath = match[1].split("|", 1)[0].split("#", 1)[0].trim();
    const resolved = linkPath ? await resolveImage(linkPath) : null;
    if (!resolved) {
      result += match[0];
    } else {
      if (resolved.asset) {
        assets.set(resolved.asset.targetPath, resolved.asset);
      }
      result += `![${escapeAltText(resolved.alt)}](${resolved.url})`;
    }
    lastIndex = embedPattern.lastIndex;
  }

  return result + line.slice(lastIndex);
}

function isInsideInlineCode(line: string, index: number): boolean {
  let delimiterLength = 0;
  let inCode = false;
  for (let cursor = 0; cursor < index;) {
    if (line[cursor] !== "`" || line[cursor - 1] === "\\") {
      cursor++;
      continue;
    }
    let runLength = 1;
    while (line[cursor + runLength] === "`") {
      runLength++;
    }
    if (!inCode) {
      inCode = true;
      delimiterLength = runLength;
    } else if (runLength === delimiterLength) {
      inCode = false;
      delimiterLength = 0;
    }
    cursor += runLength;
  }
  return inCode;
}

function escapeAltText(value: string): string {
  return value.replace(/[[\]\\]/g, "\\$&");
}
