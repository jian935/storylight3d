# 真实 3D 资产生成指南（必须在你本机运行）

## 为什么不能在对话里直接生成？
本项目的运行沙箱会拦截所有出站 API 请求，把 `Authorization` 头改写成沙箱自己的无效占位 key，
导致任何调用 Aholo 的请求都返回 `401 invalid appKey`。这是环境限制，**不是你的 key 有问题**。

因此真实资产生成**必须在你自己的电脑上**跑下面这条脚本，网页再加载本地生成的 GLB。

## 前置
- Node.js 22+（自带全局 `fetch`）
- 真实 API Key 已写入 `E:\Agent\aholo-storylight3d\.local\lux3d.key`
  （一行，纯 key 字符串，不要引号/换行）
  或运行时设置环境变量 `LUX3D_API_KEY=你的key`

## 步骤
1. 打开终端，进入项目目录：
   ```bash
   cd E:\Agent\aholo-storylight3d
   ```
2. 先预览将生成哪些实体（不消耗额度）：
   ```bash
   node scripts/generate_assets.mjs --dry-run
   ```
3. 正式生成（调用 Aholo，按 G1-Turbo 约 20s/个，逐个下载 GLB）：
   ```bash
   node scripts/generate_assets.mjs
   ```
4. 生成完成后：
   - `web/assets/generated/manifest.json` 记录「实体名 → 本地 GLB 路径」
   - `web/assets/generated/asset_0001.glb` … 为各实体模型
   - 打开 `web/index.html`（或 `npm run serve` 起本地服务），网页会自动加载这些真实资产

## 自定义故事
把你的故事写成 `.txt`，用 `[[名称:类型:描述]]` 标记实体，例如：
```
从前有只[[小精灵:character:可爱的森林精灵，绿色半透明翅膀]]，住在一座[[水晶树屋:scene:悬浮云端的透明水晶树屋]]里。
```
然后：
```bash
node scripts/generate_assets.mjs --story 我的故事.txt
```

## 可选：浏览器实时模式
网页右上「⚙ 配置 Lux3D」可填入 key，点击生成时浏览器直接调用 Aholo（需 Aholo 允许跨域）。
主路径仍是上面的「预生成 + manifest」，更稳、不暴露 key、且可离线演示。

## 排错
- `未找到 API Key`：确认 `.local/lux3d.key` 存在且是完整 key（建议从 Aholo 页面「一键复制」后粘贴，别手敲）。
- 某实体失败：脚本会跳过并继续，删掉对应 `asset_****.glb` 后重跑即可补生成。
- 解析不到 GLB：脚本会打印 Aholo 原始响应，若字段名与文档不同，可在 `web/lux3d.js` 的 `findGlbUrl` 里补映射。
