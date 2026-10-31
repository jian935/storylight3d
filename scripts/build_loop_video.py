#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 record_loop.mjs 采到的真实运行帧，合成「闭环演示」视频。

输入：deliverables/video/loop/timeline.json + frames/*.jpg
流程：
  1) 每个分段生成中文旁白（edge-tts，带缓存/重试）
  2) 按旁白时长把该分段的真实录屏帧按时间重采样（硬链接成连续序列，不占额外空间）
  3) 拼接旁白 + 段间静音 → 音轨
  4) 生成逐词高亮 ASS 字幕，ffmpeg 烧录并混音
输出：deliverables/video/StoryLight3D-闭环演示.mp4
"""
import os, re, json, asyncio, subprocess, shutil
import edge_tts
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

ROOT = r"E:\Agent\aholo-storylight3d"
LOOP = os.path.join(ROOT, "deliverables", "video", "loop")
FRAMES = os.path.join(LOOP, "frames")
SEQ = os.path.join(LOOP, "seq")
AUD = os.path.join(LOOP, "audio")
OUT = os.path.join(ROOT, "deliverables", "video")
FINAL = os.path.join(OUT, "StoryLight3D-闭环演示.mp4")
FF = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = "zh-CN-XiaoxiaoNeural"
FONT_PATH = r"C:\Windows\Fonts\msyh.ttc"
FPS = 30
GAP = 0.45          # 段间停顿（视频端用末帧保持，音频端插静音）
TITLE_DUR = 2.4     # 开场标题卡时长（后期生成，不依赖录屏里的页内叠加）

# 每段的旁白（与 record_loop.mjs 的 mark 名一一对应）
NARRATION = {
    "s0_hook": "如果写故事的人，能亲手造出故事里的世界，会怎样？",
    "s1_idea": "StoryLight3D，在故事里写下一句标记，就能把它变成真实的 3D。",
    "s2_generate": "换一个故事，点一下生成。系统解析出实体，逐个载入 Lux3D 生成的真实模型。",
    "s3_interact": "拖拽旋转，滚轮缩放。每个模型都有材质和光影，不是占位方块。",
    "s4_focus": "点一下左侧的实体，镜头自动聚焦，像走进故事里。",
    "s5_tea": "三个示例故事，同一套引擎；写完就能发布分享，在线打开。",
    "s6_close": "StoryLight3D，期待看到你的故事，长出形状。",
}


def make_title_card(path):
    W, H = 1280, 720
    img = Image.new("RGB", (W, H), (10, 14, 22))
    d = ImageDraw.Draw(img)
    for y in range(H):  # 竖向渐变
        t = y / H
        c = int(10 + 22 * (1 - abs(t - 0.45) * 1.8))
        d.line([(0, y), (W, y)], fill=(max(0, c), max(0, c + 8), max(0, c + 22)))
    for x in range(0, W, 64):   # 细网格，呼应 3D 场景
        d.line([(x, 0), (x, H)], fill=(18, 26, 40))
    for y in range(0, H, 64):
        d.line([(0, y), (W, y)], fill=(18, 26, 40))
    try:
        f_big = ImageFont.truetype(FONT_PATH, 96)
        f_sub = ImageFont.truetype(FONT_PATH, 34)
        f_tag = ImageFont.truetype(FONT_PATH, 20)
    except Exception:
        f_big = f_sub = f_tag = ImageFont.load_default()
    d.text((W // 2, 250), "StoryLight3D", font=f_big, fill=(255, 255, 255), anchor="mm")
    d.text((W // 2, 366), "写作即造物 · 故事即世界", font=f_sub, fill=(226, 232, 240), anchor="mm")
    d.text((W // 2, 446), "Aholo 3D 黑客松 · Powered by Aholo Lux3D", font=f_tag, fill=(34, 211, 238), anchor="mm")
    # 必须存成真正的 JPEG：若存 PNG 再改名 .jpg 混进 JPEG 序列，ffmpeg 会跳过这些帧
    img.save(path, format="JPEG", quality=92)


async def tts_one(text, mp3, attempt=0):
    if os.path.exists(mp3) and os.path.getsize(mp3) > 300:
        return mp3
    try:
        cm = edge_tts.Communicate(text, VOICE)
        with open(mp3, "wb") as f:
            async for ch in cm.stream():
                if ch["type"] == "audio":
                    f.write(ch["data"])
        if os.path.getsize(mp3) < 300:
            raise RuntimeError("empty")
        return mp3
    except Exception as e:
        wait = min(30, 2 ** attempt + 3)
        print("  TTS retry", attempt + 1, str(e)[:60])
        await asyncio.sleep(wait)
        if attempt >= 6:
            raise
        return await tts_one(text, mp3, attempt + 1)


def dur_of(mp3):
    out = subprocess.run([FF, "-i", mp3], capture_output=True, text=True, timeout=60).stderr
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", out)
    if not m:
        return 2.5
    h, mn, s = map(float, m.groups())
    return h * 3600 + mn * 60 + s


def tokenize(text):
    toks, buf = [], ""
    for ch in text:
        if '\u4e00' <= ch <= '\u9fff':
            if buf: toks.append(buf); buf = ""
            toks.append(ch)
        elif ch.isalnum() or ch in "%.":
            buf += ch
        else:
            if buf: toks.append(buf); buf = ""
            if toks: toks[-1] += ch
            else: toks.append(ch)
    if buf: toks.append(buf)
    return toks


def esc(t): return t.replace("{", "").replace("}", "")


def make_karaoke(text, total):
    toks = tokenize(text)
    w = [max(1, len(t)) if re.search(r'[\w\u4e00-\u9fff]', t) else 0.2 for t in toks]
    tot = sum(w) or 1
    out = []
    for t, ww in zip(toks, w):
        cs = max(1, int(round(ww / tot * total * 100)))
        out.append("{\\k%d}%s" % (cs, esc(t)))
    return "".join(out)


def fmt_time(t):
    return "%d:%02d:%05.2f" % (int(t // 3600), int((t % 3600) // 60), t % 60)


def build_ass(path, items):
    L = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1280", "PlayResY: 720",
         "[V4+ Styles]",
         "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
         "Style: Subs,Microsoft YaHei,38,&H00FCABF0,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,1,0,3,2,2,2,70,70,46,1",
         "[Events]",
         "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    for st, en, txt in items:
        L.append("Dialogue: 0,%s,%s,Subs,,0,0,0,,%s" % (fmt_time(st), fmt_time(en), txt))
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L))


def link_or_copy(src, dst):
    try:
        if os.path.exists(dst): os.remove(dst)
        os.link(src, dst)
    except Exception:
        shutil.copyfile(src, dst)


async def main():
    for d in (SEQ, AUD):
        if os.path.isdir(d): shutil.rmtree(d)
        os.makedirs(d, exist_ok=True)

    tl = json.load(open(os.path.join(LOOP, "timeline.json"), encoding="utf-8"))
    frames = tl["frames"]           # [{file, t}], t 为毫秒
    marks = {m["name"]: m for m in tl["marks"]}

    # 段间静音
    silence = os.path.join(AUD, "_sil.mp3")
    subprocess.run([FF, "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
                    "-t", "%.2f" % GAP, "-c:a", "libmp3lame", "-q:a", "9", silence],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # 开场标题卡（后期生成）+ 开头静音
    title_png = os.path.join(LOOP, "title.jpg")
    make_title_card(title_png)
    head = os.path.join(AUD, "_head.mp3")
    subprocess.run([FF, "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
                    "-t", "%.2f" % TITLE_DUR, "-c:a", "libmp3lame", "-q:a", "9", head],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    names = [n for n in NARRATION if n in marks]
    audio_parts, subs_items = [head], []
    seq_idx = 0
    for _ in range(int(round(TITLE_DUR * FPS))):
        link_or_copy(title_png, os.path.join(SEQ, "s%06d.jpg" % seq_idx))
        seq_idx += 1
    cursor = TITLE_DUR
    plan = []

    for i, name in enumerate(names):
        text = NARRATION[name]
        mp3 = os.path.join(AUD, name + ".mp3")
        await tts_one(text, mp3)
        await asyncio.sleep(0.8)
        ad = dur_of(mp3)
        vd = ad + (GAP if i < len(names) - 1 else 0.0)
        m = marks[name]
        seg_frames = [f for f in frames if m["start"] <= f["t"] < m["end"]] or frames
        n_out = max(2, int(round(vd * FPS)))
        for j in range(n_out):
            src = seg_frames[min(len(seg_frames) - 1, int(j / n_out * len(seg_frames)))]
            link_or_copy(os.path.join(FRAMES, src["file"]), os.path.join(SEQ, "s%06d.jpg" % seq_idx))
            seq_idx += 1
        audio_parts.append(mp3)
        if i < len(names) - 1:
            audio_parts.append(silence)
        subs_items.append((cursor, cursor + ad, make_karaoke(text, ad)))
        plan.append((name, ad, vd, len(seg_frames), n_out))
        cursor += vd
        print("seg %-12s audio=%.1fs video=%.1fs frames=%d→%d" % (name, ad, vd, len(seg_frames), n_out))

    total = cursor
    print("TOTAL %.1fs, seq frames=%d" % (total, seq_idx))

    # 音轨
    alist = os.path.join(AUD, "list.txt")
    with open(alist, "w", encoding="utf-8") as f:
        for p in audio_parts: f.write("file '%s'\n" % p)
    narration = os.path.join(LOOP, "narration.mp3")
    subprocess.run([FF, "-y", "-f", "concat", "-safe", "0", "-i", alist, "-c", "copy", narration],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # 画面
    silent = os.path.join(LOOP, "silent.mp4")
    # 必须 setpts 归零：image2 编码出的 mp4 会带 ~2.4s 起始偏移（实测 start=2.4），
    # 播放器会跳过开场标题卡，所以显式把首帧 PTS 归零。
    subprocess.run([FF, "-y", "-framerate", str(FPS), "-i", os.path.join(SEQ, "s%06d.jpg"),
                    "-vf", "setpts=PTS-STARTPTS",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                    "-pix_fmt", "yuv420p", "-r", str(FPS), silent],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # 字幕
    ass = os.path.join(LOOP, "subs.ass")
    build_ass(ass, subs_items)

    rel = os.path.relpath(ass, ROOT).replace("\\", "/")
    subprocess.run([FF, "-y", "-i", silent, "-i", narration,
                    "-vf", "subtitles='%s'" % rel,
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "192k", "-shortest", FINAL],
                   cwd=ROOT, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("FINAL:", FINAL, os.path.getsize(FINAL), "bytes")


if __name__ == "__main__":
    asyncio.run(main())
