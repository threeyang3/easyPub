import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { createRequire } from "module";
import { parseYamlDocument } from "./frontMatter";
import { desktopCommandEnvironment } from "./desktopEnvironment";

const execFileAsync = promisify(execFile);
const HEXO_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export type HexoCommand = "clean" | "generate" | "deploy";

export function getHexoNodeExecutable(electronVersion = process.versions.electron): string {
  // Packaged Obsidian can disable Electron's runAsNode fuse. Use installed Node
  // in the host instead of launching another Obsidian instance as if it were Node.
  return electronVersion ? (process.platform === "win32" ? "node.exe" : "node") : process.execPath;
}

export async function validateHexoBlog(blogPath: string): Promise<void> {
  if (!path.isAbsolute(blogPath)) {
    throw new Error("Hexo 仓库路径必须是绝对路径");
  }

  let blogStat;
  try {
    blogStat = await fs.stat(blogPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Hexo 仓库路径不存在");
    }
    throw error;
  }
  if (!blogStat.isDirectory()) {
    throw new Error("Hexo 仓库路径不是文件夹");
  }

  try {
    const configStat = await fs.stat(path.join(blogPath, "_config.yml"));
    if (!configStat.isFile()) {
      throw new Error();
    }
  } catch {
    throw new Error("所选文件夹不是有效的 Hexo 博客：缺少 _config.yml");
  }
}

export async function runHexoCommand(
  command: HexoCommand,
  blogPath: string
): Promise<string> {
  await validateHexoBlog(blogPath);
  const hexoExecutable = await resolveLocalHexoExecutable(blogPath);
  const args = [hexoExecutable, command];
  if (command === "generate") {
    args.push("--bail");
  }

  try {
    const { stdout } = await execFileAsync(getHexoNodeExecutable(), args, {
      cwd: blogPath,
      env: {
        ...desktopCommandEnvironment(),
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never",
      },
      timeout: HEXO_COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 10,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const commandError = error as Error & {
      code?: string | number;
      killed?: boolean;
      stderr?: string;
      stdout?: string;
    };
    if (commandError.code === "ENOENT") {
      throw new Error("找不到 Node.js，请安装 Node.js 并确认 Obsidian 的 PATH 中包含 node，然后重启 Obsidian。macOS 支持 /opt/homebrew/bin、/usr/local/bin 和 ~/.local/bin；使用 nvm 等版本管理器时，请从已激活 Node 的终端启动 Obsidian。");
    }
    if (commandError.killed || commandError.code === "ETIMEDOUT") {
      throw new Error(`Hexo ${command} 超过 10 分钟，已停止执行`);
    }
    const details = (commandError.stderr || commandError.stdout || commandError.message).trim();
    throw new Error(`Hexo ${command} 失败：${details}`);
  }
}

export async function deployHexo(blogPath: string): Promise<void> {
  await validateHexoDeployment(blogPath);
  await buildHexo(blogPath);
  await runHexoCommand("deploy", blogPath);
}

export async function buildHexo(blogPath: string): Promise<void> {
  await readHexoConfiguration(blogPath);
  await runHexoCommand("clean", blogPath);
  await runHexoCommand("generate", blogPath);
}

async function readHexoConfiguration(blogPath: string) {
  await validateHexoBlog(blogPath);
  const configContent = await fs.readFile(path.join(blogPath, "_config.yml"), "utf8");
  try {
    return parseYamlDocument(configContent);
  } catch {
    throw new Error("Hexo _config.yml 格式错误，请修复 YAML 后再构建或部署");
  }
}

export async function validateHexoDeployment(blogPath: string): Promise<void> {
  const { deploy } = await readHexoConfiguration(blogPath);
  const entries = Array.isArray(deploy) ? deploy : [deploy];
  if (!entries.length || !entries.every(entry => entry && typeof entry === "object"
    && typeof entry.type === "string" && entry.type.trim())) {
    throw new Error("Hexo 尚未配置部署方式，请先在 _config.yml 中设置 deploy.type");
  }
}

async function resolveLocalHexoExecutable(blogPath: string): Promise<string> {
  const packageRequest = "hexo/package.json";
  let packageJsonPath: string;
  try {
    // Obsidian's plugin require.resolve does not honor Node's paths option.
    packageJsonPath = createRequire(path.join(blogPath, "package.json")).resolve(packageRequest);
  } catch {
    throw new Error("博客仓库未安装本地 Hexo，请先在该目录运行 npm install");
  }

  try {
    const packageData = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const binPath = typeof packageData.bin === "string"
      ? packageData.bin
      : packageData.bin?.hexo;
    if (!binPath) {
      throw new Error("Hexo 包没有声明命令入口");
    }
    const executable = path.resolve(path.dirname(packageJsonPath), binPath);
    if (!(await fs.stat(executable)).isFile()) throw new Error("Hexo 命令入口不是文件");
    return executable;
  } catch (error) {
    if (error instanceof Error && error.message === "Hexo 包没有声明命令入口") {
      throw error;
    }
    throw new Error("无法读取博客仓库中的 Hexo 命令配置");
  }
}
