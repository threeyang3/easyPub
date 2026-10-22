# EasyPub

EasyPub 是一个桌面端 Obsidian 插件，用于从当前笔记生成 Hexo、知乎、微信公众号和小红书发布稿。

- 当前版本：`1.6.3`
- 最低 Obsidian 版本：`1.4.4`
- 支持平台：Hexo、知乎、微信公众号、小红书

EasyPub 负责生成和维护发布稿；微信公众号还提供独立的配图、封面预览与草稿箱同步，最终在微信后台发布。

## 核心能力

- 通过 `pub_id` 关联源文章和各平台发布稿。
- 更新前展示差异，避免误覆盖。
- 命令“检查发布目录（只读）”按平台定位损坏元数据、重复或缺失 ID，不修改历史稿件。
- 同名但无关的目标文件自动使用编号文件名。
- 同步源文章字段，同时保留发布稿专属字段和首次发布日期。
- Hexo 自动处理本地图片并计算 `publish_url`。
- Hexo 设置中可检查备份的 Git 状态，并分页查看历史备份原文及来源记录；不自动恢复或删除。
- 可选使用 PicGo 将本地图片转换为网络链接。
- 可选打开兼容 Hexo 仓库的 Blog Control Room。
- 公众号本地成稿独立编辑，支持常驻预览、图片适配、双比例封面裁剪和微信草稿箱同步。

## 安装

从 [GitHub Releases](https://github.com/threeyang3/easyPub/releases) 下载同一版本的：

```text
main.js
manifest.json
styles.css
```

把三个文件复制到 Vault 的 `.obsidian/plugins/easy-pub/`，然后重启 Obsidian，并在“设置 → 第三方插件”中启用 EasyPub。

> 三个文件必须来自同一次 Release 或构建，不能只替换其中一个。

## 快速开始

1. 在“设置 → EasyPub”中填写所需路径：
   - 发布到 Hexo：填写 Hexo 仓库的绝对路径。
   - 发布到其他平台：确认发布根目录，默认是 `发布`。
2. 打开要发布的笔记，点击功能区云图标，或执行 `Publish to platform`。
3. 选择平台；更新已有发布稿时，查看差异后确认。公众号已有本地稿时只打开它，避免覆盖已编辑正文。

生成完成后，EasyPub 会打开发布稿。详细的目标路径、Front Matter 和更新规则见 [发布机制与平台行为](docs/publishing.md)。

## 命令

| 命令 | 说明 |
|------|------|
| `Publish to platform` | 选择平台并生成或更新发布稿 |
| `Build Hexo locally (no deploy)` | 本地生成 Hexo 站点，不部署 |
| `Deploy to Hexo` | 部署普通 Hexo 仓库；兼容 Control Room 时打开受保护流程 |
| `Open Hexo management console` | 打开兼容 Hexo 仓库的本地管理后台 |
| `预览并同步公众号草稿` | 固定绑定当前公众号本地稿，检查图片、封面并同步微信草稿箱 |
| `引导配置微信公众号` | 分步准备账号、保存凭据并运行只读连接检查 |
| `从源文章更新公众号本地稿（确认后替换正文）` | 明确选择从源文章替换本地稿，先查看差异 |

“自动部署”默认关闭，避免普通发布意外触发外部部署。

## 文档

建议按以下顺序阅读：

1. [发布机制与平台行为](docs/publishing.md)
2. [PicGo 图片上传](docs/picgo.md)（可选）
3. [Blog Control Room 接入](docs/control-room.md)（可选）
4. [微信公众号工作台](docs/wechat.md)

完整文档索引见 [docs/README.md](docs/README.md)。

## 开发

```bash
git clone https://github.com/threeyang3/easyPub.git
cd easyPub
npm ci
npm test
npm run build
```

`npm run build` 会执行 TypeScript 检查、生成 `main.js`，并把 `main.js`、`manifest.json`、`styles.css` 同步到 `release/`。构建不会自动安装到 Vault。

常用命令：

```bash
npm test       # 核心行为测试
npm run check  # TypeScript 类型检查
npm run build  # 生产构建并更新 release/
npm run dev    # 监听源码变化
```

实现约束和代码结构见 [CLAUDE.md](CLAUDE.md) 与 [AGENTS.md](AGENTS.md)。

## 许可证

MIT
