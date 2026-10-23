import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";
import { desktopCommandEnvironment } from "./desktopEnvironment";
import { getHexoNodeExecutable } from "./hexoCommands";
import { withTimeout } from "./async";
import { ControlRoomSession, readControlRoomSession, requireControlRoomIntegration } from "./controlRoom";

type Probe = (session: ControlRoomSession) => Promise<boolean>;
const starting = new Map<string, Promise<ControlRoomSession>>();

async function responds(session: ControlRoomSession, probe: Probe): Promise<boolean> {
  try { return await withTimeout(probe(session), 1500, "后台状态检查超时"); }
  catch { return false; }
}

/** Start only the validated, fixed local service; never invoke a shell or deploy. */
export async function startControlRoom(
  blogPath: string, probe: Probe, timeoutMs = 15000
): Promise<ControlRoomSession> {
  await requireControlRoomIntegration(blogPath);
  const root = await fs.realpath(blogPath);
  const pending = starting.get(root);
  if (pending) return pending;
  const task = launch(root, probe, timeoutMs);
  starting.set(root, task);
  try { return await task; }
  finally { if (starting.get(root) === task) starting.delete(root); }
}

async function launch(root: string, probe: Probe, timeoutMs: number): Promise<ControlRoomSession> {
  const integration = await requireControlRoomIntegration(root);
  const existing = await readControlRoomSession(integration.sessionPath);
  if (existing && await responds(existing, probe)) return existing;

  // Equivalent to the validated gui script, with browser opening handled only
  // after authentication. A free loopback port avoids another blog's service.
  const child = spawn(getHexoNodeExecutable(), [path.join(root, "admin", "server.js"), "--no-open", "--port=0"], {
    cwd: root,
    env: desktopCommandEnvironment(),
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  let failure: Error | undefined;
  let exited = false;
  child.once("error", error => { failure = error; });
  child.once("exit", () => { exited = true; });
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (failure) {
        if ((failure as NodeJS.ErrnoException).code === "ENOENT") throw new Error("找不到 Node.js，请安装 Node.js；macOS 支持 Homebrew 和 ~/.local/bin，然后重试。");
        throw new Error("无法启动博客管理后台，请在博客目录运行 npm run gui 检查运行环境。");
      }
      if (exited) throw new Error("博客管理后台启动后退出，请先在博客目录运行 npm ci，再运行 npm run gui 查看错误。");
      const session = await readControlRoomSession(integration.sessionPath);
      if (session && session.pid === child.pid && await responds(session, probe) && !exited && !failure) {
        child.unref();
        return session;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("博客管理后台启动超时，已停止本次启动的进程。请在博客目录运行 npm run gui 检查。");
  } catch (error) {
    if (!exited && child.pid) child.kill();
    child.unref();
    throw error;
  }
}
