import { execFileSync } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import esbuild from "esbuild";

const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "easy-pub-tests-"));
const outputFile = path.join(outputDirectory, "core.test.cjs");

try {
  await esbuild.build({
    entryPoints: ["tests/core.test.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: outputFile,
    logLevel: "silent",
  });
  execFileSync(process.execPath, [outputFile], { stdio: "inherit" });
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
