import matter from "gray-matter";

export function parseFrontMatter(content: string): { data: any; content: string } {
  const result = matter(content);
  return {
    data: result.data || {},
    content: result.content,
  };
}

export function stringifyFrontMatter(content: string, data: any): string {
  return matter.stringify(content, data);
}

export function generatePubId(): string {
  return Math.random().toString(36).substring(2, 10);
}
