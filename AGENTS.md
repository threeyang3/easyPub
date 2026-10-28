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
- Keep `minAppVersion` aligned with any Obsidian APIs in use. Current code requires `1.5.7+` because attachment imports use `app.fileManager.getAvailablePathForAttachment`.
- Keep path logic in `utils/platforms.ts`.
- Preserve front matter fields from existing published files.
- New platform drafts inherit only their explicit property whitelist. Updates preserve target-owned properties; source refresh is an explicit field selection with preview. Legacy extra properties are removed only when selected.
- Source files should only keep source-owned metadata such as `pub_id` and `子文件`.
- Hexo child references in source front matter are plain external file paths, not wiki links.
- Never overwrite an unrelated same-name publish target; select a numbered filename automatically.
- Validate Hexo configuration and deployment prerequisites before running `clean`.
- Hexo image embeds are copied to `source/picture/easy-pub/{pub_id}` with content-addressed filenames. Preserve source Vault
  attachments and avoid rewriting embeds inside code.
- Check the confirmed target content again before writing. Search both posts and drafts by pub_id and preserve their status.
- Optional PicGo uploads use the local PicGo Server API. Defer external uploads until publish
  confirmation and reuse URLs only when the attachment content hash still matches.
- Blog Control Room discovery must require an absolute path, exact fixed GUI script, loopback-only
  session URL, one 48-character token, and a successful `/api/status` probe. Compatible repositories
  must enter their protected GUI deployment flow instead of direct Hexo deployment.

## Git

- Run `npm run build` after source or manifest changes.
- `node_modules/` and `.claude/` are gitignored.
