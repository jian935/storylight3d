# StoryLight3D 双平台发布文案

> 权威链接（勿改）：
> - GitHub：https://github.com/jian935/storylight3d
> - Demo：https://storylight3d-demo.app.workbuddy.host/?sharecode=XMGNJCAINZ
> - 作者：jian935
> - 视频：deliverables/video/StoryLight3D-演示视频.mp4（1分56秒）

---

## 一、小红书

### 标题（选一个，≤20 字）

- 主推：**把故事写成 3D 世界，只需要两个方括号**
- 备选 1：写作即造物，我在文字里造了座精灵森林
- 备选 2：不写代码，我把小说变成了能走进去的 3D 场景

### 正文（直接复制）

```
写故事的人，能不能亲手造出故事里的世界？

我做了个叫 StoryLight3D 的小东西——
在文字里用两个方括号标出想要的东西，写成
[[小精灵:character:绿翅膀的森林精灵]]
系统就自动把它变成真的 3D 模型，再拼成能旋转、能缩放、能走进去的场景。

三个故事，十个模型：
🌲 精灵森林：小精灵 / 蓝水晶树屋 / 星光钥匙 / 镜像森林
🤖 轨道机甲：锈蚀车站 / 拾荒机师 / 白蓝侦察机甲
🍵 云雾茶舍：木构茶舍 / 青瓷茶壶 / 锦鲤纸鸢

十个全是真生成出来的，带材质带光影，不是占位方块。
纯前端跑，打开网页就能玩，不用装任何东西。

流程其实很朴素：
写故事 → 解析标记 → 文生 3D → Three.js 组装成场景
一个人做完的，代码 MIT 开源了。

🔗 试玩：storylight3d-demo.app.workbuddy.host（访问码 XMGNJCAINZ）
💻 源码：GitHub 搜 jian935/storylight3d
```

### 话题标签

```
#Aholo黑客松 #AI3D #文字生成3D #Threejs #独立开发 #写作即造物 #3D建模 #AIGC #前端开发
```

### 发布注意

- **小红书不放可点击外链**：正文里把地址写成纯文本（如上），高流量时也不易被限流。
- 想要链接可点击：放**评论区第一条**，或用「私信关键词自动回复」。
- 封面建议用 `web/assets/generated/shots/hero-sprite.png`（精灵森林全景，最抓眼）。
- 配图顺序建议：hero-sprite → hero-mech → hero-tea → 视频截帧。

---

## 二、B 站

### 视频标题（≤80 字）

```
写作即造物！用两个方括号把故事变成可交互 3D 场景｜Aholo 3D 黑客松
```

### 简介（直接复制）

```
在故事里写下 [[小精灵:character:绿翅膀的森林精灵]]，它就会变成真的 3D 模型。

StoryLight3D 是一个"写作即造物"的实验：解析文字里的实体标记，调用 Aholo Lux3D 文生 3D 生成带 PBR 材质的真实模型，再用 Three.js 组装成可以拖拽旋转、滚轮缩放、点击聚焦的交互场景。

三个故事共 10 个真实资产（每个约 5 分钟生成）：
· 精灵森林：小精灵 / 水晶树屋 / 星光钥匙 / 镜像森林
· 轨道机甲：轨道车站 / 拾荒机师 / 侦察机甲
· 云雾茶舍：木构茶舍 / 青瓷茶壶 / 锦鲤纸鸢

技术栈：纯前端静态站 + Three.js（本地化，无 CDN）+ Lux3D，零后端。
单人项目，MIT 开源。

在线试玩：https://storylight3d-demo.app.workbuddy.host/?sharecode=XMGNJCAINZ
源码地址：https://github.com/jian935/storylight3d
```

### 标签

```
AI3D生成, 黑客松, Three.js, 文字生成3D, Aholo, 独立开发, AIGC, 3D建模, 编程
```

### 发布注意

- **分区**：科技 → 计算机技术（或 野生技术协会）
- **封面**：用 `hero-sprite.png`，标题文字压左上角更容易点进来
- 简介里的 URL 可以放，B 站不会自动转成可点链接，但观众能复制
- 视频文件：`deliverables/video/StoryLight3D-演示视频.mp4`（1280×720 / 1:56 / 5MB）

---

## 三、需要核对的三件事

1. **GitHub ID 是 `jian935`**（不是 jian35），全项目已对齐。
2. **Demo 必须带 `?sharecode=XMGNJCAINZ`**，不带会 403「链接不完整」。
3. 视频文案里**没有**放任何 URL，避免日后链接失效导致视频与事实不符。
