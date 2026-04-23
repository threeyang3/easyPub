# EasyPub - Obsidian 多平台发布插件

将 Obsidian 中写作的文章发布到多个平台的插件。

## 支持平台

| 平台 | 发布路径 | 特点 |
|------|----------|------|
| Hexo | `{hexoRepoPath}/source/_posts/` | 外部路径，自动生成发布链接 |
| 知乎 | `{publishBasePath}/知乎/文章/` 或 `想法/` | 按类型分子文件夹 |
| 微信公众号 | `{publishBasePath}/微信公众号/` | Vault 内部路径 |
| 小红书 | `{publishBasePath}/小红书/` | Vault 内部路径 |

## 功能

- 多平台发布，单平台选择
- 通过 `pub_id` 追踪文章版本
- 发布时显示差异对比
- 覆盖时保留创建日期
- 主文件维护 `子文件` 列表，记录各平台发布链接
- 发布文件记录 `source_file` 反向链接
- Hexo 自动生成 `publish_url`

## 项目结构

```
easyPub/
├── main.ts              # 插件入口
├── types.ts             # 类型定义
├── settings.ts          # 设置面板
├── utils/
│   ├── frontMatter.ts   # Front Matter 解析
│   ├── platforms.ts     # 平台管理
│   ├── linkUtils.ts     # 链接生成
│   └── hexoCommands.ts  # Hexo 命令
├── modals/
│   └── DiffModal.ts     # 差异对比弹窗
├── release/             # 发布文件（构建生成）
│   ├── main.js
│   ├── manifest.json
│   └── styles.css
├── manifest.json
├── package.json
├── styles.css
├── README.md
└── CLAUDE.md
```

## 开发

```bash
npm install        # 安装依赖
npm run build      # 构建并复制到 release/
npm run dev        # 开发模式（监听变化）
```

## 安装

将 `release/` 目录下的文件复制到 Obsidian vault 的 `.obsidian/plugins/easy-pub/` 目录：
- `main.js`
- `manifest.json`
- `styles.css`

## 配置

在 Obsidian 设置中找到 EasyPub：

**Hexo**
- **Hexo Repo Path**: Hexo 博客仓库根目录的绝对路径

**其他平台**
- **Publish Base Path**: 其他平台发布路径基础目录（相对于 vault 根目录，默认"发布"）

**通用**
- **Writing Path**: 写作目录（相对于 vault 根目录）
- **Auto Deploy**: 是否自动部署到 Hexo

## 使用流程

1. **选择平台**：在文章页面点击云图标或执行 "Publish to platform"
2. **差异对比**：如果是更新已有文章，会显示对比面板
3. **编辑调整**：文章复制到发布路径后自动打开，可进行平台适配微调
4. **部署**：编辑完成后，执行 "Deploy to Hexo" 部署（仅 Hexo）

## 命令

- `Publish to platform` - 选择平台并复制文章到发布路径
- `Deploy to Hexo` - 执行 hexo clean && hexo g && hexo d

## Front Matter 属性

**主文件（写作路径）**
```yaml
pub_id: abc123
子文件:
  - "[[发布/知乎/文章/文章标题]]"
  - "[[发布/Hexo/文章标题]]"
```

**发布文件（各发布路径）**
```yaml
pub_id: abc123
source_file: "[[articles/文章标题]]"
publish_url: "https://blog.com/posts/abc123"  # Hexo 自动生成
```

**知乎专属**
```yaml
zhihu_type: 文章  # 或 "想法"
```
