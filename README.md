# StoryLight3D — 写作即造物

> 在故事里用 `[[名称:类型:描述]]` 标记实体，自动把文字变成可旋转、可缩放、可聚焦的 3D 场景。
> Aholo 3D 黑客松参赛作品 · 单人项目 · 作者：绝望的土豆泥

🔗 **在线演示**：https://storylight3d-demo.app.workbuddy.host/?sharecode=XMGNJCAINZ
（链接需带 `sharecode` 参数才能访问，直接打开根域名会被平台保护机制拦截）

---

## 一句话

写作者只管写故事，在文字里用双方括号标出想「造」出来的东西；StoryLight3D 解析这些标记，
调用 **Aholo Lux3D** 文生 3D 生成真实 GLB 模型（带 PBR 材质），再用 **Three.js** 组装成一个
可以拖拽旋转、滚轮缩放、点击聚焦的交互场景。**读者不是在看截图，而是走进了你写的世界。**

## 作品集包装（旗舰版材料）

- **产品叙事** → [`docs/portfolio/StoryLight3D-产品叙事.md`](docs/portfolio/StoryLight3D-产品叙事.md)
  问题 / 洞察 / 7 条关键取舍（放弃什么、为什么、代价）/ 可核验证据 / 差异化 / 边界 / 下一步 / 面试问答。
- **闭环演示视频** → [`deliverables/video/StoryLight3D-闭环演示.mp4`](deliverables/video/StoryLight3D-闭环演示.mp4)
  47 秒、1280×720、30fps，**真实运行画面**（写故事 → 生成 → 3D → 交互 → 切换 → 收尾）+ 中文旁白 + 逐词字幕。
- **视频脚本与制作说明** → [`docs/video/闭环视频脚本.md`](docs/video/闭环视频脚本.md)
  分镜表、复现命令、踩坑记录（软件渲染 3fps / image2 起始偏移 / PNG 伪装 jpg 丢帧）。
- **作品集落地页** → [`portfolio/index.html`](portfolio/index.html)
  一页看完：标语 + 闭环视频 + 问题/洞察 + 三个取舍 + 数字 + 边界 + 入口，可直接发给面试官。

## 核心特性

- **零门槛标记语法**：`[[小精灵:character:...]]` —— 名称 / 类型 / 描述三段，类型支持 `character / creature / prop / scene`
- **真实 3D 资产**：10 个 Lux3D 生成的 GLB，全部带纹理与材质，不是占位方块
- **纯前端、零后端**：静态站即可运行；three.js 已本地 vendor 化，去除 CDN 依赖，离线也能跑
- **三档资产加载**：预生成 GLB → 实时调用 Lux3D → 占位几何体，逐级兜底，永不白屏
- **自动取景 + 环境光照**：按模型真实尺寸分层布局，PMREM 环境贴图让金属/水晶材质不发黑
- **可交互**：OrbitControls 旋转缩放、点击实体聚焦、下拉切换故事、实时加载进度
- **移动端适配**：窄屏自动切单列布局

## 三个示例故事

| 故事 | 实体 |
|------|------|
| 🌲 精灵森林 | 小精灵、水晶树屋、星光钥匙、镜像森林 |
| 🤖 轨道机甲 | 轨道车站、拾荒机师、侦察机甲 |
| 🍵 云雾茶舍 | 云雾茶舍、青瓷茶壶、锦鲤纸鸢 |

## 快速开始

纯静态站，无需构建、无需安装依赖：

```bash
cd web
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

打开即自动加载默认故事（精灵森林）并进入 3D 场景。右上角下拉可切换另外两个故事。
也可以直接在左侧编辑框改写故事文本，点「生成 3D 场景」重新解析。

## 目录结构

```
web/                      纯前端静态站
  index.html              页面骨架 + importmap
  app.js                  Three.js 场景 / 布局 / 取景 / 加载进度
  story-parse.js          纯函数解析器（[[名称:类型:描述]]，浏览器与 Node 共用）
  demo-story.js           三个示例故事文案
  lux3d.js                Lux3D 调用封装 + manifest 查询
  style.css               样式（含移动端 @media）
  vendor/                 本地化的 three.js 及 addons（去 CDN）
  assets/generated/       预生成的 10 个 GLB + manifest.json（体积大，已 gitignore）
scripts/                  资产生成 / manifest / 截图 / 视频 / 校验脚本
  record_loop.mjs         录制真实运行画面（CDP screencast，D3D11 硬件渲染）
  build_loop_video.py     闭环视频合成（edge-tts 配音 + 真实帧重采样 + ASS 字幕）
report/                   12 页项目报告书（.slide 源文件 + .pptx）
deliverables/video/       演示视频（旧版截图幻灯片 + 新版闭环演示）
docs/                     框架方案 / pitch / 交付计划
  portfolio/              旗舰作品集叙事
  video/                  闭环视频脚本与制作说明
```

## 资产重建（可选）

`web/assets/generated/` 下的 GLB 体积约 225MB，未纳入版本库，可按下述方式重建：

```bash
# 1. 用你自己的 Lux3D key 生成三个示例故事的实体（本机运行，需能访问 Aholo API）
node scripts/generate_assets.mjs --key <YOUR_LUX3D_KEY>
#    仅解析不调用 API：node scripts/generate_assets.mjs --dry-run

# 2. 依据 scripts/asset_tasks.json 的任务台账生成 manifest.json
node scripts/build_manifest.mjs
```

`scripts/asset_tasks.json` 记录了每个实体对应的 Lux3D taskid 与中文名映射，便于追溯与复现。
脚本设计为用户在本机运行：本项目的运行沙箱会拦截出站 `Authorization` 头，无法在沙箱内直连 Aholo API。

## 技术栈

- **前端**：原生 ES Modules + Three.js（本地 vendor）+ OrbitControls / GLTFLoader / PMREM
- **3D 生成**：Aholo Lux3D 文生 3D（G1-Turbo，GLB + PBR）
- **自动化**：Node + CDP 驱动无头 Edge 截图；edge-tts + ffmpeg 合成配音视频
- **部署**：WorkBuddy 静态站点发布

## 已知限制与诚实说明

- **已开源**：源码已推送到 https://github.com/jian935/storylight3d （分支 `main`）。
  225MB 的 GLB 未纳入版本库，可据 `scripts/asset_tasks.json` 里的 taskid 重建。
  （注：本机 hosts 曾被 Steam++ / Watt Toolkit 把 github 域名劫持到 127.0.0.1，
  推送需走本地代理，这与项目本身无关。）
- **演示视频字幕**：本环境下 edge-tts 不返回 WordBoundary 逐词时间轴事件，
  因此逐字高亮字幕采用「ffmpeg 取真实音频时长 + 按字/词权重均摊」的方式生成，
  是近似对齐而非逐词精确对齐。
- **3D 资产观感**：G1-Turbo 文生 3D 需要 prompt 中给出明确色相词才会充分上色；
  早期「透明水晶 / 镜面 / 木制」等仅描述材质的资产偏暗，已全部重写 prompt 并重新生成上色。

## 许可证

MIT © 2026 绝望的土豆泥 · 详见 [LICENSE](LICENSE)
