# Agent Instructions

EasyPub is an Obsidian desktop plugin for multi-platform publishing (Hexo, Zhihu, WeChat, Xiaohongshu). See CLAUDE.md for project structure and behavior details.

## Build

```bash
npm run build
```

Runs `tsc -noEmit`, bundles with esbuild, and updates `release/`.

## Coding Rules

- Use TypeScript types from `types.ts` and helpers in `utils/`.
- Hexo paths: Node `fs`. Vault-internal paths: `app.vault.adapter`.
- Keep `manifest.json` desktop-only (Node/Electron APIs required).
- Keep path logic in `utils/platforms.ts`.
- Preserve front matter fields from existing published files.

## Git

- Run `npm run build` after source or manifest changes.
- `node_modules/` and `.claude/` are gitignored.
