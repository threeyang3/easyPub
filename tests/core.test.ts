import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mergePublishedFrontMatter, mergeSourceFrontMatter } from "../utils/frontMatter";
import { generateHexoUrl, getHexoRootPath } from "../utils/linkUtils";
import {
  buildHexo,
  deployHexo,
  validateHexoBlog,
  validateHexoDeployment,
} from "../utils/hexoCommands";
import { prepareImageEmbeds } from "../utils/imageEmbeds";
import {
  getPicGoHeartbeatUrl,
  normalizePicGoUploadUrl,
  uploadWithPicGo,
} from "../utils/picgo";
import {
  findControlRoomIntegration,
  getControlRoomStatusUrl,
  parseControlRoomSession,
  readControlRoomSession,
} from "../utils/controlRoom";

async function run() {
  const controlRoomSession = parseControlRoomSession({
    version: 1,
    pid: 1234,
    host: "127.0.0.1",
    port: 4173,
    url: `http://127.0.0.1:4173/?token=${"a".repeat(48)}`,
  });
  assert.ok(controlRoomSession);
  assert.equal(
    getControlRoomStatusUrl(controlRoomSession),
    `http://127.0.0.1:4173/api/status?token=${"a".repeat(48)}`
  );
  assert.equal(
    parseControlRoomSession({
      version: 1,
      pid: 1234,
      host: "127.0.0.1",
      port: 4173,
      url: `https://example.com/?token=${"a".repeat(48)}`,
    }),
    null
  );
  assert.equal(
    parseControlRoomSession({
      version: 1,
      pid: 1234,
      host: "127.0.0.1",
      port: 4173,
      url: `http://127.0.0.1:4173/?token=${"a".repeat(48)}&next=https://example.com`,
    }),
    null
  );
  assert.equal(await findControlRoomIntegration(""), null);
  assert.equal(await findControlRoomIntegration("relative/blog"), null);
  assert.equal(
    parseControlRoomSession({
      version: 1,
      pid: 1234,
      host: "127.0.0.1",
      port: 4173,
      url: "http://127.0.0.1:4173/?token=too-short",
    }),
    null
  );

  const merged = mergePublishedFrontMatter({
    sourceData: {
      title: "新标题",
      tags: ["新标签"],
      pub_id: "source-id",
      子文件: ["不应发布"],
    },
    existingData: {
      title: "旧标题",
      tags: ["旧标签"],
      date: "2026-01-01",
      platform_status: "draft",
    },
    pubId: "article-id",
    sourceFileLink: "[[文章/来源]]",
    timestamp: "2026-07-27T00:00:00.000Z",
  });

  assert.equal(merged.title, "新标题");
  assert.deepEqual(merged.tags, ["新标签"]);
  assert.equal(merged.date, "2026-01-01");
  assert.equal(merged.platform_status, "draft");
  assert.equal(merged.pub_id, "article-id");
  assert.equal(merged.source_file, "[[文章/来源]]");
  assert.equal("子文件" in merged, false);
  assert.equal("publish_url" in merged, false);

  const source = mergeSourceFrontMatter(
    {
      title: "来源",
      source_file: "[[旧来源]]",
      publish_url: "https://old.example.com",
      updated: "2025-01-01",
    },
    "article-id",
    "[[发布/知乎/文章/来源]]"
  );
  assert.equal("source_file" in source, false);
  assert.equal("publish_url" in source, false);
  assert.equal("updated" in source, false);
  assert.deepEqual(source.子文件, ["[[发布/知乎/文章/来源]]"]);

  const preparedImages = await prepareImageEmbeds(
    [
      "正文 ![[images/Cover Image.PNG|300]]",
      "`![[inline.png]]`",
      "``![[double-inline.png]]``",
      "```md",
      "![[inside-code.png]]",
      "```",
      "![[note]]",
      "再次引用 ![[images/Cover Image.PNG]]",
    ].join("\n"),
    async (linkPath) => linkPath === "images/Cover Image.PNG"
      ? {
          sourcePath: "images/Cover Image.PNG",
          url: "/images/easy-pub/id/cover.png",
          alt: "Cover Image",
          asset: {
            sourcePath: "images/Cover Image.PNG",
            targetPath: "/blog/source/images/easy-pub/id/cover.png",
          },
        }
      : null
  );
  assert.equal(
    preparedImages.content,
    [
      "正文 ![Cover Image](/images/easy-pub/id/cover.png)",
      "`![[inline.png]]`",
      "``![[double-inline.png]]``",
      "```md",
      "![[inside-code.png]]",
      "```",
      "![[note]]",
      "再次引用 ![Cover Image](/images/easy-pub/id/cover.png)",
    ].join("\n")
  );
  assert.deepEqual(preparedImages.assets, [{
    sourcePath: "images/Cover Image.PNG",
    targetPath: "/blog/source/images/easy-pub/id/cover.png",
  }]);

  assert.equal(
    normalizePicGoUploadUrl("http://127.0.0.1:36677"),
    "http://127.0.0.1:36677/upload"
  );
  assert.equal(
    getPicGoHeartbeatUrl("http://127.0.0.1:36677/upload"),
    "http://127.0.0.1:36677/heartbeat"
  );
  const picgoUrls = await uploadWithPicGo(
    ["C:\\vault\\image.png"],
    {
      serverUrl: "http://127.0.0.1:36677/upload",
      secret: "test-secret",
    },
    async (request) => {
      assert.equal(request.url, "http://127.0.0.1:36677/upload");
      assert.equal(request.headers.Authorization, "Bearer test-secret");
      assert.deepEqual(JSON.parse(request.body), {
        list: ["C:\\vault\\image.png"],
      });
      return {
        status: 200,
        json: {
          success: true,
          result: ["https://images.example.com/image.png"],
        },
      };
    }
  );
  assert.deepEqual(picgoUrls, ["https://images.example.com/image.png"]);
  await assert.rejects(
    uploadWithPicGo(
      ["C:\\vault\\image.png"],
      { serverUrl: "http://127.0.0.1:36677" },
      async () => ({
        status: 401,
        json: { success: false, message: "Unauthorized" },
      })
    ),
    /PicGo 上传失败：Unauthorized/
  );

  const blogDirectory = await mkdtemp(path.join(os.tmpdir(), "easy-pub-hexo-"));
  try {
    await writeFile(
      path.join(blogDirectory, "_config.yml"),
      [
        "url: 'https://example.com/blog' # site URL",
        "filename_case: 1",
        "permalink: :year/:month/:title/",
      ].join("\n")
    );
    const targetPath = path.join(
      blogDirectory,
      "source",
      "_posts",
      "File Name.md"
    );
    const url = await generateHexoUrl(blogDirectory, {
      title: "Front Matter 标题",
      date: "2026-07-27T00:00:00.000Z",
    }, targetPath);
    assert.equal(url, "https://example.com/blog/2026/07/file-name/");
    assert.equal(await getHexoRootPath(blogDirectory), "/blog/");

    await writeFile(
      path.join(blogDirectory, "_config.yml"),
      [
        "url: http://threeyang3.github.io",
        "permalink: posts/:abbrlink/",
      ].join("\n")
    );
    assert.equal(
      await generateHexoUrl(blogDirectory, { abbrlink: "8d48" }, targetPath),
      "http://threeyang3.github.io/posts/8d48/"
    );
    assert.equal(
      await generateHexoUrl(blogDirectory, {}, targetPath),
      null
    );

    await assert.rejects(
      validateHexoBlog(path.join(blogDirectory, "missing")),
      /路径不存在/
    );
    await assert.rejects(
      validateHexoDeployment(blogDirectory),
      /deploy\.type/
    );

    await writeFile(
      path.join(blogDirectory, "_config.yml"),
      [
        "url: 'https://example.com/blog'",
        "filename_case: 1",
        "permalink: :year/:month/:title/",
        "deploy:",
        "  type: git",
      ].join("\n")
    );
    await assert.rejects(
      deployHexo(blogDirectory),
      /未安装本地 Hexo/
    );

    const hexoPackageDirectory = path.join(blogDirectory, "node_modules", "hexo");
    await mkdir(path.join(hexoPackageDirectory, "bin"), { recursive: true });
    await writeFile(
      path.join(hexoPackageDirectory, "package.json"),
      JSON.stringify({
        name: "hexo",
        version: "test",
        bin: { hexo: "bin/hexo.js" },
      })
    );
    await writeFile(
      path.join(hexoPackageDirectory, "bin", "hexo.js"),
      [
        'const fs = require("fs");',
        'const path = require("path");',
        'fs.appendFileSync(path.join(process.cwd(), "commands.log"), process.argv.slice(2).join(" ") + "\\n");',
        'if (process.argv[2] === "deploy" && fs.existsSync(path.join(process.cwd(), "fail-deploy"))) {',
        '  console.error("simulated deploy failure");',
        "  process.exit(2);",
        "}",
      ].join("\n")
    );

    await buildHexo(blogDirectory);
    let commands = await readFile(path.join(blogDirectory, "commands.log"), "utf8");
    assert.deepEqual(commands.trim().split("\n"), [
      "clean",
      "generate --bail",
    ]);

    await writeFile(path.join(blogDirectory, "commands.log"), "");
    await deployHexo(blogDirectory);
    commands = await readFile(path.join(blogDirectory, "commands.log"), "utf8");
    assert.deepEqual(commands.trim().split("\n"), [
      "clean",
      "generate --bail",
      "deploy",
    ]);

    await writeFile(path.join(blogDirectory, "fail-deploy"), "");
    await assert.rejects(
      deployHexo(blogDirectory),
      /Hexo deploy 失败：simulated deploy failure/
    );

    await mkdir(path.join(blogDirectory, "admin"), { recursive: true });
    await mkdir(path.join(blogDirectory, ".blog-admin"), { recursive: true });
    await writeFile(path.join(blogDirectory, "ManageBlog.bat"), "@echo off\nnpm run gui\n");
    await writeFile(path.join(blogDirectory, "admin", "server.js"), "'use strict';\n");
    await writeFile(
      path.join(blogDirectory, "package.json"),
      JSON.stringify({ scripts: { gui: "node unsafe-server.js" } })
    );
    assert.equal(await findControlRoomIntegration(blogDirectory), null);

    await writeFile(
      path.join(blogDirectory, "package.json"),
      JSON.stringify({ scripts: { gui: "node admin/server.js" } })
    );
    const integration = await findControlRoomIntegration(blogDirectory);
    assert.ok(integration);
    assert.equal(integration.launcherPath, path.join(blogDirectory, "ManageBlog.bat"));
    assert.equal(
      integration.sessionPath,
      path.join(blogDirectory, ".blog-admin", "control-room.json")
    );

    await writeFile(
      integration.sessionPath,
      JSON.stringify({
        version: 1,
        pid: 1234,
        host: "127.0.0.1",
        port: 4173,
        url: `http://127.0.0.1:4173/?token=${"b".repeat(48)}`,
      })
    );
    const discoveredSession = await readControlRoomSession(integration.sessionPath);
    assert.ok(discoveredSession);
    assert.equal(discoveredSession.token, "b".repeat(48));
  } finally {
    await rm(blogDirectory, { recursive: true, force: true });
  }

  console.log("EasyPub core tests passed");
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
