#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build StoryLight3D demo video.

Pipeline:
  edge-tts  -> Chinese narration mp3 (per sentence, with retry/backoff)
  ffmpeg    -> real audio duration per sentence
  tokenizer -> karaoke-style progressive ASS subtitle (duration distributed by char/word weight)
  ffmpeg    -> Ken-Burns slideshow clips -> concat -> mux subtitles + audio
Output: deliverables/video/StoryLight3D-演示视频.mp4
"""
import os, asyncio, subprocess, re
import edge_tts
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

ROOT = r"E:\Agent\aholo-storylight3d"
ASSETS = os.path.join(ROOT, "report", "StoryLight3D-项目报告书", "assets")
OUT = os.path.join(ROOT, "deliverables", "video")
SEGS = os.path.join(OUT, "segs")
FF = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = "zh-CN-XiaoxiaoNeural"
FONT_PATH = r"C:\Windows\Fonts\msyh.ttc"

SCENES = [
    ("title_card", [
        "你有没有想过，写故事的人，也能亲手造出故事里的世界？",
        "我是 StoryLight3D 的作者，今天用三分钟，带你看看写作即造物是怎么实现的。",
    ]),
    ("sprite", [
        "StoryLight3D 是一个写作即造物的故事编辑器。",
        "你只需要在文字里用双方括号，标记出 3D 实体，比如小精灵、角色、带绿翅膀的发光精灵。",
        "系统就会自动调用 Lux3D，把文字变成真实的三维模型。",
    ]),
    ("mech", [
        "整个流程只有四步：写故事、标实体；解析标记、生成资产清单。",
        "Lux3D 文生 3D、生成带材质的模型；最后由 Three.js 加载成可旋转、可漫游的场景。",
    ]),
    ("tea", [
        "为什么选 Lux3D？它能一次生成网格和 PBR 材质，输出标准模型。",
        "我们生成了十个真实资产，每个大约五分钟，全部可加载、可交互，不是占位方块。",
    ]),
    ("sprite", [
        "先用精灵森林：小精灵、水晶树屋、星光钥匙，真实模型直接出现在场景里。",
    ]),
    ("mech", [
        "再到轨道机甲：锈蚀的轨道车站、侦察机甲、还有拾荒机师。",
    ]),
    ("tea", [
        "最后是云雾茶舍：木构茶舍、青瓷茶壶、锦鲤纸鸢，东方意境十足。",
    ]),
    ("focus", [
        "打开就能拖拽旋转、滚轮缩放，一键切换不同故事，就像真正走进故事里。",
    ]),
    ("placeholder", [
        "工程上，这是一个纯前端、零后端的静态站。",
        "three.js 本地化、三档资产逐级兜底，连截图流水线都可复现。",
    ]),
    ("title_card", [
        "写作即造物，故事即世界。",
        "StoryLight3D，期待你在 Aholo 3D 黑客松里，看见文字长出形状。",
    ]),
]

IMG_MAP = {
    "sprite": "sprite.png",
    "mech": "mech.png",
    "tea": "tea.png",
    "focus": "focus.png",
    "placeholder": "placeholder.png",
}

GAP = 0.22  # seconds of silence/pause between sentences


def make_title_card(path):
    W, H = 1280, 720
    img = Image.new("RGB", (W, H), (15, 23, 42))
    d = ImageDraw.Draw(img)
    for i in range(0, H, 3):
        t = i / H
        c = int(15 + (34 - 15) * (1 - abs(t - 0.5) * 2))
        d.line([(0, i), (W, i)], fill=(c, c + 10, c + 28))
    try:
        f_big = ImageFont.truetype(FONT_PATH, 92)
        f_sub = ImageFont.truetype(FONT_PATH, 34)
        f_tag = ImageFont.truetype(FONT_PATH, 22)
    except Exception:
        f_big = f_sub = f_tag = ImageFont.load_default()
    d.text((W // 2, 248), "StoryLight3D", font=f_big, fill=(255, 255, 255), anchor="mm")
    d.text((W // 2, 360), "写作即造物 · 故事即世界", font=f_sub, fill=(226, 232, 240), anchor="mm")
    d.text((W // 2, 442), "Aholo 3D 黑客松 · 参赛作品", font=f_tag, fill=(34, 211, 238), anchor="mm")
    img.save(path)


async def tts_one(text, mp3_path, attempt=0):
    try:
        cm = edge_tts.Communicate(text, VOICE)
        with open(mp3_path, "wb") as f:
            async for chunk in cm.stream():
                if chunk["type"] == "audio":
                    f.write(chunk["data"])
        if os.path.getsize(mp3_path) < 200:
            raise RuntimeError("empty mp3")
        return mp3_path
    except Exception as e:
        wait = min(30, 2 ** attempt + 3)
        print("  TTS retry (%d) in %.0fs: %s" % (attempt + 1, wait, str(e)[:80]))
        await asyncio.sleep(wait)
        if attempt >= 7:
            raise
        return await tts_one(text, mp3_path, attempt + 1)


def mp3_duration(mp3):
    out = subprocess.run([FF, "-i", mp3], capture_output=True, text=True, timeout=60).stderr
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", out)
    if not m:
        return 2.0
    h, mn, s = map(float, m.groups())
    return h * 3600 + mn * 60 + s


def tokenize(text):
    toks = []
    buf = ""
    for ch in text:
        if '\u4e00' <= ch <= '\u9fff':          # Han char -> own token
            if buf:
                toks.append(buf)
                buf = ""
            toks.append(ch)
        elif ch.isalnum() or ch in "%.":
            buf += ch
        else:                                    # punctuation / space -> attach to previous token
            if buf:
                toks.append(buf)
                buf = ""
            if toks:
                toks[-1] += ch
            else:
                toks.append(ch)
    if buf:
        toks.append(buf)
    return toks


def esc(t):
    return t.replace("{", "").replace("}", "")


def make_karaoke(text, total_dur):
    toks = tokenize(text)
    weights = [max(1, len(t)) if re.search(r'[\w\u4e00-\u9fff]', t) else 0.2 for t in toks]
    tot = sum(weights) or 1
    kar = []
    for t, w in zip(toks, weights):
        cs = max(1, int(round(w / tot * total_dur * 100)))
        kar.append("{\\k%d}%s" % (cs, esc(t)))
    return "".join(kar)


def fmt_time(t):
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return "%d:%02d:%05.2f" % (h, m, s)


def build_ass(path, items):
    lines = []
    lines.append("[Script Info]")
    lines.append("ScriptType: v4.00+")
    lines.append("PlayResX: 1280")
    lines.append("PlayResY: 720")
    lines.append("[V4+ Styles]")
    lines.append("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding")
    lines.append("Style: Subs,Microsoft YaHei,36,&H00FCABF0,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,2,2,2,60,60,48,1")
    lines.append("[Events]")
    lines.append("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text")
    for start, end, karaoke in items:
        lines.append("Dialogue: 0,%s,%s,Subs,,0,0,0,,%s" % (fmt_time(start), fmt_time(end), karaoke))
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


async def main():
    os.makedirs(SEGS, exist_ok=True)
    title_path = os.path.join(OUT, "assets", "title_card.png")
    make_title_card(title_path)

    # one shared silence clip reused between sentences
    silence = os.path.join(SEGS, "silence.mp3")
    subprocess.run([FF, "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
                    "-t", "%.2f" % GAP, "-c:a", "libmp3lame", "-q:a", "9", silence],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    all_items = []
    clips = []
    audio_parts = []
    cursor = 0.0

    for key, sentences in SCENES:
        img_path = title_path if key == "title_card" else os.path.join(ASSETS, IMG_MAP[key])
        for sent in sentences:
            part = "%03d" % len(clips)
            mp3 = os.path.join(SEGS, part + ".mp3")
            print("TTS %s: %s" % (part, sent[:18]))
            # 文案未变时复用已有 mp3：省去重复 TTS，避免触发限流
            if os.path.exists(mp3) and os.path.getsize(mp3) > 200:
                print("  reuse cached mp3")
            else:
                await tts_one(sent, mp3)
                await asyncio.sleep(1.0)
            dur = mp3_duration(mp3)
            karaoke = make_karaoke(sent, dur)
            start = cursor
            end = cursor + dur
            all_items.append((start, end, karaoke))
            clips.append((img_path, dur + GAP))
            audio_parts.append(mp3)
            audio_parts.append(silence)
            cursor = end + GAP

    total = cursor - GAP
    print("TOTAL DURATION: %.2fs (%.2f min), clips=%d" % (total, total / 60, len(clips)))

    with open(os.path.join(SEGS, "audio_list.txt"), "w", encoding="utf-8") as f:
        for p in audio_parts:
            f.write("file '%s'\n" % p)
    audio_mp3 = os.path.join(OUT, "narration.mp3")
    subprocess.run([FF, "-y", "-f", "concat", "-safe", "0", "-i", os.path.join(SEGS, "audio_list.txt"),
                    "-c", "copy", audio_mp3], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    clip_files = []
    for i, (img_path, dur) in enumerate(clips):
        cf = os.path.join(SEGS, "clip_%03d.mp4" % i)
        pan_period = max(dur, 1) * 0.6 + 1.5
        vf = ("scale=1472:920,"
              "crop=1280:720:x='96+96*sin(t/%s)':y='100+100*cos(t/%s)',"
              "setsar=1") % (pan_period, pan_period)
        subprocess.run([FF, "-y", "-loop", "1", "-i", img_path, "-t", "%.3f" % dur,
                        "-vf", vf, "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        "-preset", "veryfast", "-crf", "20", cf],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        clip_files.append(cf)

    with open(os.path.join(SEGS, "video_list.txt"), "w", encoding="utf-8") as f:
        for cf in clip_files:
            f.write("file '%s'\n" % cf)
    silent_mp4 = os.path.join(OUT, "silent.mp4")
    subprocess.run([FF, "-y", "-f", "concat", "-safe", "0", "-i", os.path.join(SEGS, "video_list.txt"),
                    "-c", "copy", silent_mp4], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    ass_path = os.path.join(OUT, "subs.ass")
    build_ass(ass_path, all_items)

    final = os.path.join(OUT, "StoryLight3D-演示视频.mp4")
    # subtitles 滤镜不能吃带盘符冒号的 Windows 绝对路径（冒号被当作参数分隔符 → exit -22）
    # 改为相对路径 + cwd=ROOT，输入/输出仍用绝对路径
    rel_ass = os.path.relpath(ass_path, ROOT).replace("\\", "/")
    subprocess.run([FF, "-y", "-i", silent_mp4, "-i", audio_mp3,
                    "-vf", "subtitles='%s'" % rel_ass,
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "192k", "-shortest", final],
                   cwd=ROOT, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("FINAL:", final, os.path.getsize(final), "bytes")


if __name__ == "__main__":
    asyncio.run(main())
