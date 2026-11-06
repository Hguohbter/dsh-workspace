# 同学跑酷

轻量网页版跑酷（地铁跑酷风格），纯静态、零依赖、零构建，手机浏览器直接玩。

线上地址：<https://hguohbter.github.io/dsh-workspace/subway/>

## 操作

| 动作 | 手机 | 键盘 |
| --- | --- | --- |
| 换道 | 左右滑动 | ← → / A D |
| 跳跃 | 上滑 / 轻点屏幕 | ↑ / W / 空格 |
| 翻滚（钻横杆） | 下滑 | ↓ / S |
| 暂停 | 切到后台自动暂停 | Esc |

## 目录

```
index.html      入口与三个界面（开始 / 结算 / 暂停）
style.css       界面样式
app.js          全部游戏逻辑（约 700 行）：投影、生成器、碰撞、渲染
assets/
  student-front.webp  正面全身（开始页）
  student-back.webp   背面全身（游戏内奔跑）
  student-face.webp   头部方形（头像 / 结算页）
```

## 换成别的同学

1. 准备两张白底全身照（正面、背面，姿势越直越好）。
2. 生成透明底素材：

   ```powershell
   python scripts/prep-subway-assets.py <正面.jpg> <背面.jpg>
   ```

   脚本会按“与画面四边连通的白像素”抠底，白鞋底、白衣领这类内部白色不会被误删，边缘做了去白边处理。
3. 改 `docs/subway/app.js` 顶部的 `CFG.name`。

想加多个角色就在 `CFG` 里加一个角色数组 + 开始页做选择，目前只做了单人。

## 想调手感

都在 `app.js` 顶部的 `CFG`：

| 字段 | 作用 |
| --- | --- |
| `speedMin` / `speedMax` | 初速 / 最高速（单位模糊，大致等于每秒走的“米”） |
| `jumpV` / `gravity` | 跳跃初速与重力，跳跃总时长约 `2*jumpV/gravity` 秒 |
| `camH` | 相机高度，越大视角越俯视、角色在画面里越靠下 |
| `playerZ` | 角色距相机的距离，越大角色越小 |
| `rollTime` | 翻滚时长 |

难度节奏在 `update()` 里的 `game.speed` 和 `spawnPattern()` 的间距。

## 验证

```powershell
node --check docs/subway/app.js
node scratch/test-subway.mjs   # 无浏览器跑逻辑：主循环/输入/物理/碰撞/计分
```

## 注意

GitHub Pages 是公网可访问的，真人照片放上去等于公开，上传前请确认本人同意。
