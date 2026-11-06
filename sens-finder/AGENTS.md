# sens-finder — 项目约定

网页版 FPS 灵敏度检测器。纯前端、零依赖、无构建；打开 `index.html` 或 `node scripts/serve.mjs` 即可运行。

## 运行与验证

```powershell
cd D:\Dev\dsh-workspace\sens-finder
node --test test/          # 核心数学单测
node scripts/serve.mjs     # http://127.0.0.1:4173
node scripts/publish-pages.mjs  # 同步到 ../docs/sens-finder（Pages 发布）
```

浏览器内自测：

- `index.html?autotest=1` 跑一次合成快速测试，输出 `data-autotest="pass"` + `#autotest-report`。
- `index.html?demo=flick` 冻结测试画面，便于截图。

## 代码约定

- 三个脚本都是 classic script（非 ES module），以便 `file://` 双击运行：
  - `src/core.js` 暴露 `window.SensCore`，同时支持 CommonJS（Node 单测）。
  - `src/engine.js` 暴露 `window.AimEngine`。
  - `src/app.js` 暴露 `window.SensLab`（调试与自动化入口）。
- 新增数学 / 评分逻辑优先放进 `core.js`，并补 `test/core.test.js`。
- 不引入运行时依赖，不引入构建步骤；不要改成必须起 dev server 才能运行。
- 中文 UI 文案用简体中文；代码、注释、变量名用英文。
- 配色与组件变量集中在 `styles.css` 顶部 `:root`；新样式沿用现有 token。
- 修改测试物理（目标半径、时长、权重）时，同步更新 `README.md` 的表格与自测基线。
- 不提交 `localStorage` 数据、截图临时文件或 `%TEMP%` 产物；`docs/` 只保留最终展示图。

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/core.js` | cm/360 换算、靶序、评分、二次拟合、置信度 |
| `src/engine.js` | Canvas 相机 / 目标 / 命中 / 渲染 |
| `src/app.js` | 状态机、Pointer Lock、暂停、结果、图表、存储、自测 |
| `test/core.test.js` | 17 个 Node 测试 |
| `scripts/serve.mjs` | 静态服务器（无依赖） |

## 完成标准

- `node --test test/` 全绿。
- `?autotest=1` 返回 `data-autotest="pass"`，`#autotest-report` 中 `chartDrawn: true`。
- 设置 / 测试 / 结果三屏在 1440、1024、390 宽度下无横向溢出。
- 改动后在 README 的验证章节记录命令与结果。
