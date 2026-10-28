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
    external: ["electron", "jsdom"],
    plugins: [{ name: 'obsidian-test-runtime', setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
      build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
        export class App {} export class Plugin {} export class Modal {}
        export class Notice {} export class Setting {} export class PluginSettingTab {}
        export class ItemView { async setState() {} } export class FuzzySuggestModal {} export class Component {}
        export class MarkdownRenderer {}
        export class TFile {} export class TFolder {} export class FileSystemAdapter {}
        export const normalizePath = p => p.replaceAll('\\\\', '/');
        export const requestUrl = () => { throw new Error('Unexpected network request in test'); };
      `, loader: 'js' }));
    } }],
  });
  execFileSync(process.execPath, [outputFile], { stdio: "inherit", env: { ...process.env, NODE_PATH: path.join(process.cwd(), "node_modules") } });
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
