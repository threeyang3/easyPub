# Agent Instructions

This repository is an Obsidian desktop plugin written in TypeScript. Follow the existing small-module structure and keep changes scoped.

## Project Summary

EasyPub copies the active Obsidian note to publishing targets:

- Hexo: external path under `{hexoRepoPath}/source/_posts`
- Zhihu: vault path under `{publishBasePath}/知乎/{文章|想法}`
- WeChat Official Account: vault path under `{publishBasePath}/微信公众号`
- Xiaohongshu: vault path under `{publishBasePath}/小红书`

Article identity is `pub_id` in front matter. Source notes maintain `子文件`; published files maintain `source_file`.

## Build And Verify

Run this before finalizing code changes:

```bash
npm run build
```

The build performs `tsc -noEmit`, bundles with esbuild, and refreshes:

- `main.js`
- `release/main.js`
- `release/manifest.json`
- `release/styles.css`

## Coding Rules

- Prefer TypeScript types from `types.ts` and existing helpers in `utils/`.
- Do not use `app.vault.adapter` for Hexo external absolute paths; use Node `fs`.
- Do use `app.vault.adapter` for vault-internal platform paths.
- Keep `manifest.json` desktop-only because Node/Electron APIs are required.
- Keep path generation in `utils/platforms.ts`; avoid duplicating path string logic elsewhere.
- Preserve front matter fields from existing published files where the current publish flow already does so.
- Keep comments brief and only where they clarify behavior that is easy to misuse.

## Git Hygiene

- `node_modules/` and `.claude/` are ignored and should not be committed.
- This repository keeps built plugin files in git, so run `npm run build` after source or manifest changes.
- Check `git status --short` before reporting completion.

## Useful Files

- `main.ts`: command registration and publish workflow
- `settings.ts`: settings UI
- `modals/DiffModal.ts`: diff confirmation modal
- `utils/platforms.ts`: platform metadata, target path generation, wiki links
- `utils/linkUtils.ts`: Hexo URL generation
- `utils/hexoCommands.ts`: Hexo deploy commands
- `README.md`: user-facing documentation
