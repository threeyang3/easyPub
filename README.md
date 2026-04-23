# EasyPub

一个 Obsidian 插件，用于将文章发布到多个平台。

## 功能特性

- **多平台支持**：Hexo、知乎、微信公众号、小红书
- **文章追踪**：通过 `pub_id` 追踪文章版本
- **差异对比**：更新时显示内容变化
- **属性保留**：覆盖时保留创建日期
- **双向链接**：主文件与发布文件互相链接
- **自动生成链接**：Hexo 自动计算发布 URL

## 平台配置

| 平台 | 发布路径 | 说明 |
|------|----------|------|
| Hexo | `{hexoRepoPath}/source/_posts/` | 外部路径，自动生成 `publish_url` |
| 知乎 | `{publishBasePath}/知乎/文章/` 或 `想法/` | 按类型分子文件夹 |
| 微信公众号 | `{publishBasePath}/微信公众号/` | Vault 内部路径 |
| 小红书 | `{publishBasePath}/小红书/` | Vault 内部路径 |

## 安装

### 手动安装

1. 下载 `main.js`、`manifest.json`、`styles.css`
2. 复制到 Obsidian vault 的 `.obsidian/plugins/easy-pub/` 目录
3. 重启 Obsidian，在设置中启用插件

### 开发安装

```bash
git clone https://github.com/your-repo/easy-pub.git
cd easy-pub
npm install
npm run build
```

## 使用方法

### 发布流程

1. 打开要发布的文章
2. 点击左侧栏云图标，或使用命令 `Publish to platform`
3. 选择目标平台
4. 如果是更新，查看差异对比后确认
5. 文章复制到发布路径并自动打开
6. 进行平台适配编辑
7. （仅 Hexo）执行 `Deploy to Hexo` 部署

### 命令

| 命令 | 说明 |
|------|------|
| `Publish to platform` | 选择平台并发布文章 |
| `Deploy to Hexo` | 执行 `hexo clean && hexo g && hexo d` |

### 设置

**Hexo**
- **Hexo Repo Path**：Hexo 博客仓库根目录的绝对路径

**其他平台**
- **Publish Base Path**：其他平台发布路径基础目录（默认"发布"）

**通用**
- **Writing Path**：写作目录
- **Auto Deploy**：是否自动部署

## Front Matter 属性

### 主文件（写作路径）

```yaml
---
title: 文章标题
pub_id: abc123
子文件:
  - "[[发布/知乎/文章/文章标题]]"
  - "[[发布/Hexo/文章标题]]"
---
```

### 发布文件（发布路径）

```yaml
---
title: 文章标题
pub_id: abc123
source_file: "[[articles/文章标题]]"
publish_url: "https://blog.com/posts/abc123"
---
```

### 知乎专属属性

```yaml
---
zhihu_type: 文章  # 可选值：文章、想法
---
```

## 开发

```bash
npm install        # 安装依赖
npm run build      # 构建生产版本
npm run dev        # 开发模式（监听变化）
```

## 许可证

MIT
