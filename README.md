# 小鱼和小猫的情侣空间 🐱🐟

一个可以用**微信直接打开**的情侣小站。

打开先是「我们的空间」首页：云朵壁纸铺满屏幕，中间是猫鱼头像和恋爱天数，
下面四张功能卡（写信 / 回忆 / 日历 / 愿望），右下角有一只可以拖来拖去的**布布**。
点「写给你的信」进入信封流程 → 轻触火漆印章开信 → 信纸铺开，一个字一个字打出心里话
（光标是一颗跳动的小爱心）→ 按「打开这段影像」才播出那段竖屏视频 → 最后是落款和爱心雨。

陪着你的是三只手绘形象：**小猫**、**小鱼**、**装爱心的小罐子**——它们会在信封旁偷看、
在信纸角落轮流出场、吐泡泡、留爪印；点它们一下会撒出爱心或泡泡。

---

## 文件结构

```
happy/
├── index.html            入口（微信里打开这个文件）
├── styles.css            外观：配色、云朵壁纸、形象动画
├── config.js             ★ 文字内容都在这：每一幕的话、视频路径、开关
├── app.js                逻辑：信封动画、打字机、视频、布布控制台、形象与特效
├── assets/
│   ├── video1.mp4        ★ 信里那段视频（1080×1442 竖屏，29MB）
│   ├── bg-mobile.jpg     手机背景壁纸（872×1548 竖屏）
│   ├── bg-desktop.jpg    电脑背景壁纸（2412×1548 横屏）
│   ├── bubu/             布布的 34 个动作 GIF（本地，4MB）
│   └── README.txt        视频规格与压制命令
└── tests/                自检脚本（不影响站点，可删）
```

## 1. 先看效果（在你电脑上）

不能用 `file://` 直接打开（浏览器会拦掉视频），要起个本地服务器：

```powershell
python -m http.server 8080
```

然后浏览器打开 <http://127.0.0.1:8080>。按 `F12` 切成手机尺寸（比如 iPhone 12），看到的就是微信里的效果。

## 2. 改文字内容

打开 `config.js`，全部内容都在里面，改完保存刷新即可：

```js
window.LOVE_CONFIG = {
  cover: { intro: '写给你的一封信', hint: '轻触这里，打开信封', miniNote: '只给你看' },

  mascots: { enabled: true, cat: true, fish: true, jar: true, seal: 'fish' },

  stages: [                       // 一幕一幕往下演（现在有 7 幕）
    {
      name: '启封',                // 左上角的小标签
      title: '写给小鱼姐姐',        // 信纸顶部的标题（打字机打出来）
      mascot: 'jar',              // 这一幕陪着你的形象：cat / fish / jar
      open: ['展信佳。', '嘻嘻，这是我第一次给你写电子情书哦！']
    },
    {
      name: '回忆',
      title: '我们一路走来',
      mascot: 'fish',
      open: ['把过去我们美好的回忆一一珍藏，', '……'],
      video: 'assets/video1.mp4',        // ← 视频；留空 '' 就跳过
      action: '打开这段影像',             // ← 文字打完后按钮上写什么（点了才播视频）
      caption: '只留给你看哦！',          // ← 视频下面那行小字
      close: ['其实那天我紧张得手心全是汗，', '……']   // ← 视频之后接着打的话
    }
  ],

  ending: { sign: '永远站在你这边的人\n留于某个想你的深夜', replay: '轻触重新看一遍' },

  video: { mode: 'inline', muted: true, loop: false, rate: 0.92, closePause: 1400, aspect: 'auto' },

  typing: { speed: 15, titleSpeed: 11 },   // 打字速度：每秒几个字

  fx: { particles: true, sealSound: true, heartCursor: true }
};
```

**关于 `action`**：不写的话，有视频的幕按钮默认显示「打开这段影像」，没视频的显示「继续」。
每一幕都是「打字打完后停下来等你点」，不会自己往下滚。

**打字速度**：`typing.speed` 是每秒打几个字，8 = 很慢、15 = 默认、24 = 偏快。
句末标点（。！？）后会自动多停一拍。

**视频比例**：`video.aspect` 默认 `'auto'`，按视频真实尺寸自适应（竖屏就竖着显示，不裁画面）。
想固定就写 `'16/9'`、`'3/4'` 这种。

## 3. 换视频

把视频命名为 `video1.mp4` 放进 `assets/` 就完事（配置已经指向它）。想用别的名字就改 `config.js` 里那一行。

| 规格 | 建议 |
| --- | --- |
| 编码 | MP4（H.264 + AAC）；**别用 HEVC/H.265**，微信常不认 |
| 音频 | 一定要 AAC。mp3 装进 mp4 在部分安卓上没声音 |
| 大小 | 50MB 以内（GitHub 单文件上限 100MB） |
| 其他 | 必须加 `-movflags +faststart`，否则微信要下完整个文件才能播 |

```
ffmpeg -i 原视频.mov -c:v libx264 -preset slower -crf 20 -pix_fmt yuv420p ^
       -c:a aac -b:a 160k -movflags +faststart video1.mp4
```

## 4. 背景壁纸

`assets/bg-mobile.jpg`（手机）和 `assets/bg-desktop.jpg`（电脑）由 `styles.css` 里的媒体查询自动切换，
**两边只下载自己那一张**。断点在 769px：

```css
.space-bg-img{background:#8bd9f7 url("assets/bg-mobile.jpg") center/cover no-repeat;}
@media (min-width:769px){ .space-bg-img{background-image:url("assets/bg-desktop.jpg");} }
```

换图：把新图命名成同名文件替换，或改上面的路径。想调裁切位置就把 `center` 改成 `top`、`center 30%` 之类。

## 5. 布布

首页右下角那只布布：可以**拖动**（带惯性）、**点一下**换动作、**长按**打开功能栏
（动作库 / 便签 / 番茄钟 / 提醒 / 快捷 / 设置），数据存在浏览器 localStorage 里。

- 动作图在 `assets/bubu/`，共 34 张，**本地文件，不依赖任何第三方仓库**
- 改台词：`app.js` 里的 `BUBU_ACTIONS` 数组，每项是 `['assets/bubu/xxx.gif', '台词']`
- 换动作图：把新 GIF 放进 `assets/bubu/`（文件名用英文），再改 `BUBU_ACTIONS` 里对应的路径
- 待机图是 `assets/bubu/idle.gif`（`BUBU_FALLBACK`）

## 6. 自检（可选）

```powershell
node tests/smoke.js            # 完整流程自检
```

> 注意：`tests/smoke.js` 是早期按「自动推进」流程写的，现在流程改成了「按钮/轻触推进」，
> 这个脚本会跑到超时。需要的话可以按新流程重写。

## 7. 上线到微信

已部署在 GitHub Pages：**https://catandfish111.github.io/CAT-FISH/**

改完内容后再传一次，等 30~60 秒生效。两种方式：

**网页上传**（不用装东西）：仓库页面点 **Add file → Upload files**，把改动的文件拖进去，Commit。

**git 命令**：
```
git clone https://github.com/catandfish111/CAT-FISH.git
# 改完文件后
git add -A && git commit -m "更新内容" && git push
```

### 微信里的注意点（代码已处理，知道就行）

- 微信会拦住带声音的自动播放，所以信里的视频默认**静音**开始，点视频右下角小喇叭开声音
- 页面右上角音符按钮控制的是开信、打字、点布布的音效
- 有些安卓机（X5 内核）视频首帧会先转圈，属正常
- 改了内容后 TA 若看到的还是旧的，让 TA 下拉刷新，或在链接后加 `?v=2`
