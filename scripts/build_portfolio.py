#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 portfolio/source.html 构建成「单文件自包含」的 portfolio/index.html。

为什么需要：落地页常在预览器/沙箱里打开，只提供单个 HTML，不提供同目录静态资源。
若用 `<video src="assets/x.mp4">` / `<img src="assets/x.png">` / 外链 md，就会：
  - 视频全黑、海报不显示（资源没被服务）
  - 「完整产品叙事」「下载闭环视频」点了没反应（相对外部路径 404）
因此把视频/截图内联为 data URI（视频只存一份，用 JS 同时给 <video> 与下载按钮），
叙事入口改为页内锚点。

用法：
    python scripts/build_portfolio.py
输入：
    portfolio/source.html
    portfolio/assets/web.mp4      （960 宽，约 1.5MB）
    portfolio/assets/{sprite,mech,tea}.jpg
输出：
    portfolio/index.html
"""
import os, base64

ROOT = r"E:\Agent\aholo-storylight3d"
P = os.path.join(ROOT, "portfolio")
SRC = os.path.join(P, "source.html")
OUT = os.path.join(P, "index.html")


def b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def main():
    html = open(SRC, encoding="utf-8").read()
    assets = {
        "%%VIDEO%%": os.path.join(P, "assets", "web.mp4"),
        "%%SPRITE%%": os.path.join(P, "assets", "sprite.jpg"),
        "%%MECH%%": os.path.join(P, "assets", "mech.jpg"),
        "%%TEA%%": os.path.join(P, "assets", "tea.jpg"),
    }
    for token, path in assets.items():
        if not os.path.exists(path):
            raise SystemExit("缺少资源：" + path)
        data = b64(path)
        if token not in html:
            raise SystemExit("模板缺少占位符：" + token)
        html = html.replace(token, data)
        print("%-10s %8.1f KB -> b64 %8.1f KB" % (os.path.basename(path), os.path.getsize(path) / 1024, len(data) / 1024))

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("OUT:", OUT, "%.1f KB" % (os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
