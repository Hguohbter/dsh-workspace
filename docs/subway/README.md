# 胖虎快跑

白天街道 + 学校的轻量网页跑酷，纯静态、零依赖、零构建，手机浏览器直接玩。

线上地址：<https://hguohbter.github.io/dsh-workspace/subway/>

## 操作

| 动作 | 手机 | 键盘 |
| --- | --- | --- |
| 换道 | 左右滑动 | ← → / A D |
| 跳跃 | 上滑 / 轻点屏幕 | ↑ / W / 空格 |
| 翻滚（钻横幅） | 下滑 | ↓ / S |
| 暂停 | 切到后台自动暂停 | Esc |

## 玩法要素

- **障碍**：橙色路障（跳过）、红横幅（翻滚钻过）、黄色校车（必须换道）
- **金币**：连续吃分，跳跃弧线上的金币要跳起来拿
- **道具**（偶尔出现在空车道上）：
  - 🔴 磁铁：8 秒内自动吸金币
  - 🔵 护盾：挡一次撞击
  - 🟡 加速：4.5 秒冲刺，期间撞飞障碍、速度变快
- 撞车结算，可把成绩传到在线排行榜

## 目录

```
index.html      入口与四个界面（开始 / 结算 / 排行榜 / 暂停）
style.css       界面样式
app.js          全部游戏逻辑：投影、生成器、碰撞、骨骼小人、道具、排行榜
assets/
  panghu-face.webp   头部特写（头像 / 结算页）
  panghu-head.webp   后脑勺（游戏内骨骼小人的脑袋）
  panghu-front.webp  正面全身（原始素材）
  panghu-back.webp   背面全身（原始素材）
```

## 怎么加一个新同学（后门）

1. 准备两张白底全身照（正面、背面，姿势尽量直）。
2. 跑素材脚本，`<id>` 用拼音，产物会自动带上这个前缀：

   ```powershell
   python scripts/prep-subway-assets.py xiaoming 小明正面.jpg 小明背面.jpg
   ```

   脚本会按“与画面四边连通的白像素”抠底（白鞋底、白衣领不会被误删），
   并打印**头心横向偏移**，如果头看起来偏了，把这个值填到角色的 `headOffsetX`。

3. 打开 `docs/subway/app.js`，在文件顶部的 `CHARACTERS` 数组里加一条：

   ```js
   {
     id: 'xiaoming',
     name: '小明',
     face: 'assets/xiaoming-face.webp',
     head: 'assets/xiaoming-head.webp',
     headScale: 1,      // 头大了/小了调这个
     headOffsetX: 0,    // 头左右偏了就填脚本打印的比例（例如 -0.02）
     colors: {          // 四肢和衣服的颜色，从照片上取几个色值
       jacket: '#2f5fa8', jacketDark: '#1f4076',
       pants: '#333a48', pantsDark: '#262c38',
       shoe: '#1b2025', skin: '#e0b294', pack: '#15181c'
     }
   }
   ```

4. 存盘刷新。`CHARACTERS` 超过 1 个时，开始页会自动出现一排头像可以切换，选择会记在本地；
   也可以用 `?c=xiaoming` 直接指定某个角色。

游戏标题在 `CFG.title`，默认「胖虎快跑」。

## 在线排行榜

用 [ntfy.sh](https://ntfy.sh) 的公共 topic 当免费存储，不需要注册、不需要后端：

- 上传 = 往 topic 发一条消息；拉榜 = `GET /<topic>/json?poll=1&since=all`
- 按名字去重取最高分，取前 20

限制：消息 **12 小时后过期**，topic 公开（谁都能看能写）。想换真数据库，改 `CFG.lb` 和 `lbFetch/lbSubmit`。
换 topic 就是换一个空榜（`CFG.lb.topic`）。

## 想调手感

都在 `app.js` 顶部的 `CFG`：

| 字段 | 作用 |
| --- | --- |
| `speedMin` / `speedMax` | 初速 / 最高速 |
| `jumpV` / `gravity` | 跳跃初速与重力 |
| `camH` | 相机高度，越大越俯视、角色越靠下 |
| `playerZ` | 角色距相机的距离，越大角色越小 |
| `rollTime` | 翻滚时长 |
| `powerChance` | 每个障碍组出现道具的概率 |

## 验证

```powershell
node --check docs/subway/app.js
node scratch/test-subway.mjs   # 无浏览器跑逻辑：主循环/输入/物理/碰撞/计分/道具/排行榜排序
```

## 注意

GitHub Pages 是公网可访问的，真人照片放上去等于公开，上传前确认本人同意。
