# EasyPub Claude Notes

EasyPub is a desktop-only Obsidian plugin for copying Markdown notes into platform-specific publishing locations. It currently supports Hexo, Zhihu, WeChat Official Account, and Xiaohongshu.

## Core Behavior

- `main.ts` is the plugin entry point and command registration surface.
- Publishing starts from the active Obsidian file via the ribbon icon or `Publish to platform`.
- Articles are tracked by front matter `pub_id`.
- Source files keep a `子文件` list pointing to generated platform files.
- Published files keep `source_file` and, for Hexo, may keep `publish_url`.
- Existing published articles are found by `pub_id`; updates show `DiffModal` before overwrite.
- New articles never overwrite an unrelated same-name target; a numbered filename is selected automatically.
- Hexo publishing converts image-type Obsidian embeds into copied Markdown image assets.
- Optional PicGo mode uploads local image embeds after publish confirmation and replaces them
  with remote URLs for every platform.

## Platform Paths

Hexo is external to the vault:

- Base setting: `hexoRepoPath`
- Publish directory: `{hexoRepoPath}/source/_posts`
- File access must use Node `fs`, not `app.vault.adapter`.
- Hexo deploy resolves the blog's locally installed Hexo CLI, then runs `clean`,
  `generate --bail`, and `deploy` with a timeout and non-interactive Git auth.
- Compatible Blog Control Room repositories are opened through their fixed
  `ManageBlog.bat` launcher. EasyPub validates and probes the loopback session instead of
  bypassing the repository's guarded source-sync and deploy workflow.

Other platforms are vault-internal:

- Base setting: `publishBasePath`, default `发布`
- Supported vault-internal platforms: Zhihu, WeChat Official Account, Xiaohongshu.
- Zhihu uses subfolders `文章` or `想法`, selected by `zhihu_type`.
- WeChat and Xiaohongshu write directly under their platform folder.
- Vault-internal reads and writes should use `app.vault` APIs; front matter updates should use `app.fileManager.processFrontMatter`.

## Important Files

```text
main.ts                 Plugin lifecycle, publish flow, file IO, deploy command
settings.ts             Obsidian settings tab
types.ts                Settings, platform, and article metadata types
modals/DiffModal.ts     Update confirmation and diff preview modal
utils/frontMatter.ts    gray-matter parse/stringify helpers
utils/platforms.ts      Platform definitions, path generation, wiki links
utils/linkUtils.ts      Hexo URL generation from _config.yml
utils/hexoCommands.ts   Hexo command execution
utils/controlRoom.ts    Safe Blog Control Room discovery and session validation
utils/imageEmbeds.ts    Safe Obsidian image embed parsing and Markdown conversion
utils/picgo.ts          PicGo Server URL validation and upload response handling
docs/picgo.md           User setup, security, and troubleshooting guide for PicGo
docs/control-room.md    Obsidian install, Control Room protocol, deployment boundary, troubleshooting
manifest.json           Obsidian plugin manifest
release/                Built files for manual installation
```

## Development Commands

```bash
npm install
npm test
npm run check
npm run build
npm run dev
```

`npm run build` runs TypeScript checking and production esbuild, then copies `main.js`, `manifest.json`, and `styles.css` into `release/`.

## Implementation Notes

- Keep `manifest.json` `isDesktopOnly: true`; the plugin uses Node/Electron APIs.
- Keep `manifest.json` `minAppVersion` at `1.4.4` or higher unless `processFrontMatter` usage is removed.
- Keep generated `main.js` and `release/` in sync after source changes by running `npm run build`.
- Sanitize generated publish filenames; article titles may contain characters invalid on Windows.
- Create vault-internal nested directories one segment at a time through `app.vault.createFolder`.
- Use recursive `fs.mkdir` for external Hexo directories.
- Validate `_config.yml`, local Hexo installation, and `deploy.type` before destructive
  generation/deployment steps.
- Preserve existing published front matter by default when updating an article, but recompute `pub_id`, `source_file`, `updated`, and Hexo `publish_url`.
- Source-owned front matter values override matching published values; platform-only fields remain preserved.
- Preserve existing `date` on published files; source files should not gain published-only fields such as `source_file`, `publish_url`, `date`, or `updated`.
- Source `子文件` values remain wiki links for vault-internal platforms and plain external paths for Hexo.
- `autoDeploy` should only trigger for Hexo publishing.
- `autoDeploy` defaults to `false`; keep routine publishing free of unexpected external deployment.
- If a compatible Blog Control Room is present, deploy commands and `autoDeploy` must open the
  protected management flow rather than call Hexo deploy directly.
- Control Room discovery requires an absolute repository path, fixed `scripts.gui`, and the
  expected launcher/server files. Session URLs must be loopback-only with exactly one valid token,
  then pass `/api/status` before reuse.
- Dynamic permalink fields such as `abbrlink` may be generated by Hexo; refresh the active
  article's local `publish_url` after a successful deployment.
- Hexo image copies live under `source/images/easy-pub/{pub_id}` with deterministic names.
  Do not rewrite note embeds or examples inside fenced/inline code.
- PicGo uploads must be deferred until the user confirms an update. Cache URLs by attachment
  path plus content hash, and never read image-host credentials from PicGo configuration.
- PicGo Server Secret is distinct from image-host credentials: it is optional, stored in local
  Obsidian plugin data, and sent as a Bearer token. Keep `docs/picgo.md` aligned with this behavior.
- If updating source front matter fails after writing a target, restore or remove the target to avoid partial success.

## Release

- Current plugin version: `1.3.0`
- Current minimum Obsidian version: `1.4.4`
- GitHub Releases for manual installation must include `main.js`, `manifest.json`, and `styles.css` in addition to the source archive.
- Development builds do not install themselves into a Vault. Copy all three files from the same
  `release/` build and reload the plugin before manual verification.

## Release / GitHub

Repository: `https://github.com/threeyang3/easyPub`

Before pushing changes:

```bash
npm run build
git status --short
```

Do not commit `node_modules/` or local assistant/tooling folders. `.gitignore` already excludes them.
