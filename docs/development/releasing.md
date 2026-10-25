# 插件版本发布流程

[文档首页](../README.md) · [测试](testing.md) · [贡献约定](contributing.md) · [版本状态](../status.md)

插件发版、安装到 Vault、Hexo 网站部署、公众号发布是四种不同动作。本流程只覆盖 EasyPub 插件版本，不自动部署博客或发布文章。

## 1. 确认发布范围

明确目标版本、包含的提交、兼容性变化和对应 PR。核对发布分支没有无关改动；需要配套博客更新的功能应记录双方版本/提交。未合并分支中的能力不能写成稳定版已具备。

在 `docs/releases/<版本>.md` 写发布说明：用户可见变化、修复、配置或数据迁移要求、验证范围、剩余限制。不要把整个开发对话复制为发布说明。

## 2. 同步版本与构建

保持以下文件一致：

- package.json 和 package-lock.json 的包版本。
- manifest.json 的插件版本、最低 Obsidian 版本及 desktop-only 声明。
- versions.json 的新版本映射。
- 构建生成的 release/manifest.json。
- README 和文档状态中的稳定版本描述。

`version-bump.mjs` 从 package.json 同步 manifest.version，并用当前 manifest.minAppVersion 更新 versions.json。`npm version` 会触发 package.json 的 version 生命周期，其中包含 git add；不要在不了解其行为时用它自动提交或打标签。也可明确编辑包版本后运行同步脚本，检查差异后自行提交。

```bash
node version-bump.mjs
npm test
npm run build
```

按改动范围补齐浏览器、原生和必要的真实服务验收，记录准确的 commit。最低版本声明不等于所有历史宿主均已测试。

## 3. 合并门禁

检查 PR 的全部 CI，而不是仅检查本机 build：macOS、Windows、Linux 构建及浏览器任务。CI 中还会验证生成产物已提交。

合并后核对主分支的最终提交及 CI。Squash 合并会改变 commit ID；Release 应指向实际合并提交，不能仅凭分支名称假定产物相同。比对最终源树或从最终提交重新构建，并再次核对安装文件。

## 4. 创建 Release

项目已有 tag 使用不带 `v` 的版本号，例如 `1.7.1`。创建新 tag/Release 前核对目标提交、版本号和是否为预发布。

必须附加同一次构建的三个安装文件：

```text
release/main.js
release/manifest.json
release/styles.css
```

源码压缩包不能替代这三个附件。LICENSE 随仓库和 release/ 构建保留，但正常安装必需文件是上述三项。发布后下载附件，与本地待发字节或校验和比对，确认不是旧文件或混合版本。

发版是外部发布动作，应在明确的发布授权范围内执行；文档编写或本地构建不会自行触发 Release。

## 5. 安装验收与回退

在测试 Vault 中备份现有插件配置，结束忙碌任务后替换三个安装文件并重载。核对实际版本、账号与 AI 配置可用性、现有草稿关联和一条代表性工作流。安装新包不应自动创建远端草稿。

保留上一版安装文件与对应配置备份。回退不自动迁移新元数据，也不撤销已完成的远端写入。若配置无法解密或新旧 schema 不兼容，优先在副本中确认恢复路径，见[恢复指南](../operations/backup-and-recovery.md)。
