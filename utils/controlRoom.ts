import fs from "fs/promises";
import path from "path";

const SESSION_FILE = path.join(".blog-admin", "control-room.json");
const WINDOWS_LAUNCHER = "ManageBlog.bat";
const CONTROL_ROOM_SCRIPT = "node admin/server.js";
const TOKEN_PATTERN = /^[a-f0-9]{48}$/;

export interface ControlRoomIntegration {
  launcherPath: string;
  sessionPath: string;
}

export interface ControlRoomSession {
  version: 1;
  pid: number;
  host: "127.0.0.1";
  port: number;
  url: string;
  token: string;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function findControlRoomIntegration(
  hexoRepoPath: string
): Promise<ControlRoomIntegration | null> {
  const configuredPath = hexoRepoPath.trim();
  if (!configuredPath || !path.isAbsolute(configuredPath)) return null;

  const root = path.resolve(configuredPath);
  const packagePath = path.join(root, "package.json");
  const launcherPath = path.join(root, WINDOWS_LAUNCHER);
  const serverPath = path.join(root, "admin", "server.js");

  if (!(await isFile(packagePath)) || !(await isFile(launcherPath)) || !(await isFile(serverPath))) {
    return null;
  }

  try {
    const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    if (packageJson.scripts?.gui !== CONTROL_ROOM_SCRIPT) return null;
  } catch {
    return null;
  }

  return {
    launcherPath,
    sessionPath: path.join(root, SESSION_FILE),
  };
}

export async function requireControlRoomIntegration(
  hexoRepoPath: string
): Promise<ControlRoomIntegration> {
  const integration = await findControlRoomIntegration(hexoRepoPath);
  if (!integration) {
    throw new Error("该 Hexo 仓库未提供兼容的 Blog Control Room");
  }
  return integration;
}

export function parseControlRoomSession(value: unknown): ControlRoomSession | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !Number.isInteger(candidate.pid) ||
    Number(candidate.pid) <= 0 ||
    candidate.host !== "127.0.0.1" ||
    !Number.isInteger(candidate.port) ||
    Number(candidate.port) < 1 ||
    Number(candidate.port) > 65535 ||
    typeof candidate.url !== "string"
  ) {
    return null;
  }

  try {
    const url = new URL(candidate.url);
    const token = url.searchParams.get("token") || "";
    const queryKeys = [...url.searchParams.keys()];
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      Number(url.port) !== Number(candidate.port) ||
      url.pathname !== "/" ||
      url.username ||
      url.password ||
      url.hash ||
      queryKeys.length !== 1 ||
      queryKeys[0] !== "token" ||
      url.searchParams.getAll("token").length !== 1 ||
      !TOKEN_PATTERN.test(token)
    ) {
      return null;
    }

    return {
      version: 1,
      pid: Number(candidate.pid),
      host: "127.0.0.1",
      port: Number(candidate.port),
      url: url.toString(),
      token,
    };
  } catch {
    return null;
  }
}

export async function readControlRoomSession(
  sessionPath: string
): Promise<ControlRoomSession | null> {
  try {
    return parseControlRoomSession(JSON.parse(await fs.readFile(sessionPath, "utf8")));
  } catch {
    return null;
  }
}

export function getControlRoomStatusUrl(session: ControlRoomSession): string {
  const url = new URL("/api/status", session.url);
  url.searchParams.set("token", session.token);
  return url.toString();
}
