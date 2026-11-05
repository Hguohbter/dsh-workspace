# dsh-workspace

DSH 的日常实验与临时项目根目录。会话工作区应设为此目录，git 与构建工具才能正常写盘。

## 结构
- 每个子项目一个目录，含各自的 `README.md` 与 `AGENTS.md`。
- 大体积数据、构建产物、模型文件不进 git，放 `D:\Dev\_data\<项目名>`。
- `scripts/`：可复用的脚本；`scratch/`：一次性试验（已被 gitignore）。

## 约定
- 新建项目流程：建目录 → `git init -b main` → `README.md` → 首次提交。
- commit message：`<scope>: <简述>`，正文说明"为什么"。
- 不把密钥、token、个人数据提交进仓库。

## 完成标准
- 改动可运行，并给出验证命令与结果；未验证的部分明确说明。
