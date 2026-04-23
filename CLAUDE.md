# EasyPub Claude Notes

EasyPub is a desktop-only Obsidian plugin for copying Markdown notes into platform-specific publishing locations. It currently supports Hexo, Zhihu, WeChat Official Account, and Xiaohongshu.

## Core Behavior

- `main.ts` is the plugin entry point and command registration surface.
- Publishing starts from the active Obsidian file via the ribbon icon or `Publish to platform`.
- Articles are tracked by front matter `pub_id`.
- Source files keep a `子文件` list pointing to generated platform files.
- Published files keep `source_file` and, for Hexo, may keep `publish_url`.
- Existing published articles are found by `pub_id`; updates show `DiffModal` before overwrite.

## Platform Paths

Hexo is external to the vault:

- Base setting: `hexoRepoPath`
- Publish directory: `{hexoRepoPath}/source/_posts`
- File access must use Node `fs`, not `app.vault.adapter`.
- Hexo deploy uses `npx hexo clean`, `npx hexo generate`, then `npx hexo deploy`.

Other platforms are vault-internal:

- Base setting: `publishBasePath`, default `发布`
- Zhihu uses subfolders `文章` or `想法`, selected by `zhihu_type`.
- WeChat and Xiaohongshu write directly under their platform folder.
- Vault-internal reads and writes should use `app.vault.adapter`.

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
manifest.json           Obsidian plugin manifest
release/                Built files for manual installation
```

## Development Commands

```bash
npm install
npm run build
npm run dev
```

`npm run build` runs TypeScript checking and production esbuild, then copies `main.js`, `manifest.json`, and `styles.css` into `release/`.

## Implementation Notes

- Keep `manifest.json` `isDesktopOnly: true`; the plugin uses Node/Electron APIs.
- Keep generated `main.js` and `release/` in sync after source changes by running `npm run build`.
- Sanitize generated publish filenames; article titles may contain characters invalid on Windows.
- Create vault-internal nested directories one segment at a time through the Obsidian adapter.
- Use recursive `fs.mkdir` for external Hexo directories.
- Preserve existing `date` and `publish_url` when updating an existing published article.
- `autoDeploy` should only trigger for Hexo publishing.

## Release / GitHub

Repository: `https://github.com/threeyang3/easyPub`

Before pushing changes:

```bash
npm run build
git status --short
```

Do not commit `node_modules/` or local assistant/tooling folders. `.gitignore` already excludes them.
