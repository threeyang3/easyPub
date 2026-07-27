# Agent Instructions

EasyPub is an Obsidian desktop plugin for multi-platform publishing (Hexo, Zhihu, WeChat, Xiaohongshu). See CLAUDE.md for project structure and behavior details.

## Build

```bash
npm run build
```

Runs `tsc -noEmit`, bundles with esbuild, and updates `release/`.

Before the build, use `npm test` for core metadata and Hexo URL behavior.

## Coding Rules

- Use TypeScript types from `types.ts` and helpers in `utils/`.
- Hexo paths: Node `fs`. Vault-internal paths: prefer `app.vault` / `app.fileManager` APIs.
- Hexo commands must use the blog repository's local Hexo package. Do not use `npx` fallback
  or download a CLI implicitly.
- Keep `manifest.json` desktop-only (Node/Electron APIs required).
- Keep `minAppVersion` aligned with any Obsidian APIs in use. Current code requires `1.4.4+` because it uses `app.fileManager.processFrontMatter`.
- Keep path logic in `utils/platforms.ts`.
- Preserve front matter fields from existing published files.
- Source-owned fields override matching published values; preserve platform-only fields.
- Source files should only keep source-owned metadata such as `pub_id` and `子文件`.
- Hexo child references in source front matter are plain external file paths, not wiki links.
- Never overwrite an unrelated same-name publish target; select a numbered filename automatically.
- Validate Hexo configuration and deployment prerequisites before running `clean`.

## Git

- Run `npm run build` after source or manifest changes.
- `node_modules/` and `.claude/` are gitignored.
