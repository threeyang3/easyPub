import os from "os";
import path from "path";

/** GUI applications on macOS may not inherit the terminal's Node PATH. */
export function desktopCommandEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const result = { ...environment };
  if (platform === "darwin") {
    // Preserve the user's selected Node version and add only fixed system locations.
    // Do not execute login-shell profiles or add the current repository to PATH.
    const directories = (environment.PATH ?? "").split(":").filter(Boolean);
    result.PATH = [...new Set([...directories,
      "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin",
      path.join(os.homedir(), ".local", "bin"),
    ])].join(":");
  }
  return result;
}
