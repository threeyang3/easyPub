import { randomBytes } from "crypto";
import { FrontMatterData } from "../types";

export function assertPublishUnchanged(expected: string | null, current: string | null): void {
  if (expected !== current) {
    throw new Error("发布稿已被修改、移动或删除，请重新发布并确认新的差异");
  }
}

export function completeControlRoomMetadata(data: FrontMatterData, title: string, used: Set<string>): FrontMatterData {
  if (Object.prototype.hasOwnProperty.call(data, "password")) {
    throw new Error("此博客禁止明文 password，请改用 password_secret");
  }
  const result: FrontMatterData = { ...data, title: data.title || title };
  if (result.categories === undefined || result.categories === "") result.categories = [];
  if (result.tags === undefined || result.tags === "") result.tags = [];
  if (!result.abbrlink) {
    if (used.size >= 65536) throw new Error("文章短链接空间已用完");
    let id: string;
    do { id = randomBytes(2).toString("hex"); } while (used.has(id));
    result.abbrlink = id;
  } else if (used.has(String(result.abbrlink))) {
    throw new Error("文章 abbrlink 与其他文章重复，请修改后再发布");
  }
  return result;
}
