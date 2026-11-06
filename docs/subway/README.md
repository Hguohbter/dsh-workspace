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
index.html      入口与四个界面（开始 / 结算 / 排行榜 / 暂停）
style.css       界面样式
app.js          全部游戏逻辑：投影、生成器、碰撞、骨骼小人、排行榜
assets/
  student-face.webp   头部特写（开始页 / 结算页头像）
  student-head.webp   后脑勺（游戏内骨骼小人的脑袋）
  student-front.webp  正面全身（原始素材）
  student-back.webp   背面全身（原始素材）
```

## 角色的动作是怎么做的

游戏内不是贴一张照片平移，而是一个 2D 骨骼小人：

- **脑袋**用照片（后脑勺 + 猫耳）裁出来贴上去，保证一眼认出是谁；
- **四肢/躯干**用 Canvas 程序化绘制（颜色从照片采样：酒红外套、深灰运动裤、黑鞋、黑书包）；
- 跑动时按相位摆动髋/膝/肩，小腿用“投影缩短”模拟朝镜头折腿，速度越快步频越高；
- 跳跃收腿抬手、翻滚缩成一团，各自有独立姿势。

好处是任何动作都能加、不会有照片分段的接缝；代价是不再是照片里的真实身形。

## 在线排行榜

用 [ntfy.sh](https://ntfy.sh) 的公共 topic 当免费存储，**不需要注册、不需要后端、不需要改仓库配置**：

- 上传成绩 = 往 topic 发一条消息；拉榜 = `GET /<topic>/json?poll=1&since=all`
- 读取时按名字去重取最高分，排序取前 20

限制（写在代码注释里）：消息 **12 小时后过期**（相当于“近半天榜”），topic 是公开的，别人知道名字就能看/写。想换成真正的数据库，改 `CFG.lb` 和 `lbFetch/lbSubmit` 两个函数即可（Firebase / Supabase 都行）。

换 topic 就在 `app.js` 里改 `CFG.lb.topic` —— 改完等于开了一个全新空榜。

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
| `lb.topic` | 排行榜的 topic，换一个就是一个空榜 |

难度节奏在 `update()` 里的 `game.speed` 和 `spawnPattern()` 的间距。

## 验证

```powershell
node --check docs/subway/app.js
node scratch/test-subway.mjs   # 无浏览器跑逻辑：主循环/输入/物理/碰撞/计分
```

## 注意

GitHub Pages 是公网可访问的，真人照片放上去等于公开，上传前请确认本人同意。
