import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const HEXO_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export type HexoCommand = "clean" | "generate" | "deploy";

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
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: blogPath,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
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
  await runHexoCommand("clean", blogPath);
  await runHexoCommand("generate", blogPath);
}

export async function validateHexoDeployment(blogPath: string): Promise<void> {
  await validateHexoBlog(blogPath);
  const configContent = await fs.readFile(path.join(blogPath, "_config.yml"), "utf8");
  const lines = configContent.split(/\r?\n/);
  const deployLineIndex = lines.findIndex((line) => /^deploy\s*:/.test(line));
  if (deployLineIndex < 0) {
    throw new Error("Hexo 尚未配置部署方式，请先在 _config.yml 中设置 deploy.type");
  }

  const inlineValue = lines[deployLineIndex].replace(/^deploy\s*:\s*/, "").trim();
  if (/\btype\s*:/.test(inlineValue)) {
    return;
  }

  for (let index = deployLineIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }
    if (!/^\s/.test(line)) {
      break;
    }
    if (/^\s+(?:-\s*)?type\s*:\s*\S/.test(line)) {
      return;
    }
  }

  throw new Error("Hexo 尚未配置部署方式，请先在 _config.yml 中设置 deploy.type");
}

async function resolveLocalHexoExecutable(blogPath: string): Promise<string> {
  const packageRequest = "hexo/package.json";
  let packageJsonPath: string;
  try {
    packageJsonPath = require.resolve(packageRequest, { paths: [blogPath] });
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
    return path.resolve(path.dirname(packageJsonPath), binPath);
  } catch (error) {
    if (error instanceof Error && error.message === "Hexo 包没有声明命令入口") {
      throw error;
    }
    throw new Error("无法读取博客仓库中的 Hexo 命令配置");
  }
}
