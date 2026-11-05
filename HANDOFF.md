# 交接说明（临时文件，完成后可删）

上一段会话在 `C:\Users\Hgh\Documents\deepseek-harness\default-workspace` 完成，因 Windows ACL 沙箱限制无法在 D 盘执行 git，故交接。

## 待办

1. 运行 `scripts\init-repo.ps1` —— 会 `git init -b main`、写入本地身份、完成首次提交。
2. 完成后删除本文件。

## 已完成

| 项 | 位置 |
| --- | --- |
| 全局约定 | `C:\Users\Hgh\.dsh\AGENTS.md` |
| 项目约定 | `D:\Dev\dsh-workspace\AGENTS.md` |
| 示例技能 | `C:\Users\Hgh\.dsh\skills\disk-space-audit\SKILL.md` |
| 安全插件 | `@deepseek-ai/dsh-experimental-auto-review`（已装，随 DSH 启动加载） |

## 关键事实

- **沙箱**：Windows ACL 授权绑在"会话创建时的工作区"上，子进程（git/node/构建）只能写该目录。改 cwd、切权限预设、工具提权都解不开——只能换会话工作区。
- **Auto 预设**：每个会话要单独 `/permission auto` 或选带 `EXP` 的「自动审查」；通用设置里不提供 Auto。
- **git 身份**：Hgh / m17383652469@outlook.com，只写本地配置，全局 config 保持为空。
- **profile 里有第三方 bundle** `dshmarket`（插件市场），非官方包。
