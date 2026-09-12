把视频放在这个文件夹里（assets/）📹
==================================

一、文件名
  默认配置已经指向：assets/video1.mp4
  → 只要你把视频命名为 video1.mp4 放在这里，什么都不用改，刷新就能看到。

  想用别的名字（例如 our-day.mp4），就把 config.js 里那一行改成一样的：
      video: 'assets/our-day.mp4',

  第二个视频：文件放这里（例如 video2.mp4），再把 config.js 里
  第五幕（name: '第二幕'）的 video 填上 'assets/video2.mp4'。

  命名注意：
  · 用小写英文 + 数字 + 连字符，别用空格和中文（微信里偶发加载失败就是它）
  · 后缀必须是 .mp4（不是把别的格式直接改后缀，要是真的 mp4）
  · 换新视频时建议换个文件名（如 video1b.mp4），否则微信可能还在用旧的缓存

二、格式规格（微信里播放最稳）
  · 容器/编码：MP4（H.264 视频 + AAC 音频）；不要用 HEVC/H.265，微信常不认
  · 分辨率：1080p 以内都行，竖屏 1080×1920 也支持（会自动等比放进框里）
  · 时长：15 秒 ~ 1 分钟最好，太长看着容易走神
  · 大小：单个 50MB 以内最好（GitHub 单文件上限 100MB，超了传不上去）
  · 要转换/压缩的话，ffmpeg 一行命令：
      ffmpeg -i 原视频.mov -c:v libx264 -crf 23 -preset medium -c:a aac -b:a 128k -movflags +faststart video1.mp4
    最后的 -movflags +faststart 很关键：把索引放到文件开头，微信里能边下边播，不用先转圈很久。

三、怎么传上来（二选一）
  A. 网页上传（不用装任何东西）
     1. 打开 https://github.com/catandfish111/CAT-FISH/tree/main/assets
     2. 右上角 Add file → Upload files
     3. 把 video1.mp4 拖进去 → 下面点 Commit changes
     4. 等 30~60 秒，刷新站点就能看到（GitHub Pages 会自动重新发布）
     ⚠️ 网页上传的进度条卡住多半是文件太大或网络不稳，超过 50MB 建议先压缩。

  B. 用 git 命令（文件大、或要经常换）
     git clone https://github.com/catandfish111/CAT-FISH.git
     # 把 video1.mp4 拷进 assets/ 里
     git add assets/video1.mp4
     git commit -m "加入第一段视频"
     git push

四、还没传视频时会怎样
  不会出错：信纸里会显示一张写着「视频还没放进来」的提示卡，
  旁边有「再看一次」按钮，点「跳过视频」可以直接往下看。
