import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function runHexoCommand(command: string, blogPath: string): Promise<string> {
  const { stdout, stderr } = await execAsync(`npx hexo ${command}`, {
    cwd: blogPath,
    maxBuffer: 1024 * 1024 * 10,
  });
  if (stderr && !stdout) {
    throw new Error(stderr);
  }
  return stdout;
}

export async function deployHexo(blogPath: string): Promise<void> {
  await runHexoCommand("clean", blogPath);
  await runHexoCommand("generate", blogPath);
  await runHexoCommand("deploy", blogPath);
}
