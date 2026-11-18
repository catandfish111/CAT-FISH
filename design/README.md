# 设计稿 · 未接入线上

这一份是「布布房间拆解 + 回忆模块独立设计」的交付物，**只是设计，没有改动站点代码**。
线上的 `index.html / app.js / space-app.js / sync.js` 都还是原样，`data` 分支的数据结构也不变。

## 内容

| 文件 | 说明 |
| --- | --- |
| [01-bubu-room-decomposition.md](01-bubu-room-decomposition.md) | 布布房间的四层职责、7 个模块的归属、路由与迁移顺序 |
| [02-memories-module.md](02-memories-module.md) | 回忆模块的页面、数据模型、照片管线、冲突合并、代码落点 |
| [memories-prototype.html](memories-prototype.html) | 可点击原型（单文件、零依赖） |
| [shots/](shots) | 原型截图（390px 手机宽 + 桌面预览） |

## 怎么看原型

- 电脑：双击 `memories-prototype.html`，右侧有说明卡，手机框里可以直接点。
- 手机 / 微信：打开 Pages 地址
  `https://catandfish111.github.io/CAT-FISH/design/memories-prototype.html`
  （第一次打开可能需要等 Pages 构建几十秒）
- 直接看某个状态：在地址后加 `?demo=detail`、`?demo=editor`、`?demo=album`、`?demo=empty`、`?demo=confirm`、`?demo=save`、`?demo=undo`。

原型里的数据是示例数据，存在浏览器 `localStorage`，不会写入仓库的 `data` 分支。

## 页面预览

| 列表 | 详情 |
| --- | --- |
| ![列表](shots/m-list-390.png) | ![详情](shots/m-detail-390.png) |

| 编辑 | 相册 |
| --- | --- |
| ![编辑](shots/m-editor-390.png) | ![相册](shots/m-album-390.png) |

## 下一步

按 `02-memories-module.md` 第 11 节落地：新增 `router.js` / `memories.js` / `memories.css`，复用现有 `Space`、`PhotoStore`，不改 `sync.js`。
上线前记得把新文件加进 `tools/deploy.js` 的 `FILES` 白名单。
