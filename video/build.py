#!/usr/bin/env python3
"""Assemble the Spark demo video from the real recording, real screenshots, and narration."""
import subprocess, os, json, shutil
from PIL import Image, ImageDraw, ImageFont, ImageFilter

V = os.path.dirname(os.path.abspath(__file__))
SRC, AUD, FR, OUT = [os.path.join(V, d) for d in ("src", "audio", "frames", "out")]
for d in (FR, OUT):
    os.makedirs(d, exist_ok=True)
REC = "/Users/mike/Desktop/Spark-demo-20260912.mp4"
if not os.path.exists(REC):
    REC = "/Users/mike/dev/hackathon/.evidence/Spark-demo.mp4"
W, H, FPS = 1920, 1080, 30
BG = (13, 16, 26)
SERIF = "/System/Library/Fonts/Supplemental/Georgia.ttf"
SANS = "/System/Library/Fonts/HelveticaNeue.ttc"
PAD = 0.7  # seconds of silence after each narration line


def font(path, size, index=0):
    try:
        return ImageFont.truetype(path, size, index=index)
    except Exception:
        return ImageFont.truetype(SERIF, size)


def dur(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    return float(r.stdout.strip())


def title_card(name, headline, sub, foot=None):
    bg = Image.open(os.path.join(SRC, "bg-higgsfield.png")).convert("RGB").resize((W, H), Image.LANCZOS)
    d = ImageDraw.Draw(bg)
    y = 380
    for line in headline.split("\n"):
        d.text((140, y), line, font=font(SERIF, 112), fill=(245, 240, 230))
        y += 122
    d.text((144, y + 18), sub, font=font(SANS, 40), fill=(200, 196, 186))
    if foot:
        d.text((144, H - 110), foot, font=font(SANS, 28), fill=(150, 148, 140))
    p = os.path.join(FR, name + ".png")
    bg.save(p)
    return p


def caption_overlay(name, text, tag):
    """Lower third caption plus a small provenance tag, transparent PNG."""
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = font(SANS, 44)
    tw = d.textlength(text, font=f)
    x0, y0 = 96, H - 176
    d.rounded_rectangle((x0, y0, x0 + tw + 64, y0 + 92), radius=14, fill=(13, 16, 26, 222))
    d.text((x0 + 32, y0 + 22), text, font=f, fill=(245, 240, 230))
    ft = font(SANS, 26)
    ttw = d.textlength(tag, font=ft)
    d.rounded_rectangle((W - ttw - 140, 40, W - 80, 92), radius=10, fill=(13, 16, 26, 200))
    d.text((W - ttw - 110, 52), tag, font=ft, fill=(220, 180, 110))
    p = os.path.join(FR, name + ".png")
    im.save(p)
    return p


def seg_from_video(name, start, length, audio, caption, tag="Real recording"):
    ov = caption_overlay(name + "_cap", caption, tag)
    out = os.path.join(FR, name + ".mp4")
    vf = (f"[0:v]trim=start={start}:duration={length},setpts=PTS-STARTPTS,"
          f"scale=-2:{H}:flags=lanczos,pad={W}:{H}:(ow-iw)/2:0:color=#0d101a,fps={FPS},"
          f"tpad=stop_mode=clone:stop_duration={length}[v0];"
          f"[v0][1:v]overlay=0:0:format=auto,trim=duration={length},"
          f"fade=t=in:st=0:d=0.35,fade=t=out:st={length-0.35}:d=0.35[v]")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", REC, "-i", ov, "-i", audio,
                    "-filter_complex", vf + f";[2:a]apad,atrim=duration={length}[a]",
                    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-r", str(FPS), out], check=True)
    return out


def seg_from_still(name, image, length, audio, caption=None, tag="Screenshot", zoom=True):
    inputs = ["-loop", "1", "-t", str(length), "-i", image]
    fc = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=#0d101a,fps={FPS}")
    if zoom:
        fc += (f",scale={W*2}:{H*2},zoompan=z='1+0.04*on/({length}*{FPS})':x='iw/2-(iw/zoom/2)':"
               f"y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS}")
    fc += "[v0]"
    if caption:
        ov = caption_overlay(name + "_cap", caption, tag)
        inputs += ["-i", ov]
        fc += f";[v0][1:v]overlay=0:0:format=auto[v1]"
        last = "[v1]"
        aidx = 2
    else:
        last = "[v0]"
        aidx = 1
    fc += f";{last}trim=duration={length},fade=t=in:st=0:d=0.35,fade=t=out:st={length-0.35}:d=0.35[v]"
    fc += f";[{aidx}:a]apad,atrim=duration={length}[a]"
    out = os.path.join(FR, name + ".mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-i", audio, "-filter_complex", fc,
                    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-r", str(FPS), out], check=True)
    return out


def a(i):
    return os.path.join(AUD, f"s{i}.wav")


segs = []
# 0 Title
L0 = dur(a(0)) + PAD
segs.append(seg_from_still("00_title", title_card("title", "Spark", "A browser agent that keeps your place. Local first.",
                                                    "Agents, Everywhere hackathon  ·  Columbus  ·  September 12, 2026"),
                           L0, a(0), zoom=False))
# 1 Capture: recording 0 to 17s
L1 = dur(a(1)) + PAD
segs.append(seg_from_video("01_capture", 0, L1, a(1), "One hotkey. The page context comes with the note."))
# 2 Review and sync: recording 17 to 24.5, then the Ambiguous task list read back
L6 = dur(a(6)) + PAD
rec_part = 7.5
segs.append(seg_from_video("02_review", 17.0, rec_part, a(6), "Review the draft first. Sync is a switch you flip."))
# remaining narration continues over the Ambiguous tasks screenshot: split audio
rest = L6 - rec_part
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a(6), "-ss", str(rec_part), os.path.join(AUD, "s6b.wav")], check=True)
segs.append(seg_from_still("02b_readback", os.path.join(SRC, "ambiguous-tasks.jpg"), rest,
                           os.path.join(AUD, "s6b.wav"), "Read back from Ambiguous after sync.", tag="Ambiguous, live workspace"))
# 3 Meeting import: recording 24.5 to 35.5
L3 = dur(a(3)) + PAD
segs.append(seg_from_video("03_meeting", 24.5, L3, a(3), "Calendar event imported from Ambiguous. Reminder runs locally."))
# 4 What works today: recording 35.5 to 47 then calendar screenshot
L5 = dur(a(5)) + PAD
rec2 = 11.5
segs.append(seg_from_video("04_local", 35.5, rec2, a(5), "Local only by default. The key stays in the browser profile."))
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a(5), "-ss", str(rec2), os.path.join(AUD, "s5b.wav")], check=True)
segs.append(seg_from_still("04b_calendar", os.path.join(SRC, "ambiguous-calendar.jpg"), L5 - rec2,
                           os.path.join(AUD, "s5b.wav"), "The same event, in the Ambiguous calendar.", tag="Ambiguous, live workspace"))
# 5 Takeover scope: real meeting card with the greyed Takeover button
L4 = dur(a(4)) + PAD
card = Image.open(os.path.join(SRC, "spark-visible-logo-card.png")).convert("RGB").crop((400, 690, 2160, 1400))
card = card.resize((1720, int(1720 * card.height / card.width)), Image.LANCZOS)
comp = Image.new("RGB", (W, H), BG); comp.paste(card, ((W - card.width) // 2, 110))
scope_png = os.path.join(FR, "scope.png"); comp.save(scope_png)
segs.append(seg_from_still("05_scope", scope_png, L4, a(4),
                           "Takeover is the design goal. Not claimed in this build.", tag="Extension UI, current build", zoom=False))
# 6 Close
L7 = dur(a(7)) + PAD
segs.append(seg_from_still("06_close", title_card("close", "Capture. Prepare.\nReview. Follow through.",
                                                    "Spark keeps your place. Nothing leaves your machine until you say so.",
                                                    "github.com/MikeSchirtzinger/spark"),
                           L7, a(7), zoom=False))

lst = os.path.join(FR, "list.txt")
with open(lst, "w") as f:
    for s in segs:
        f.write(f"file '{s}'\n")
final = os.path.join(OUT, "spark-demo-narrated.mp4")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", final], check=True)
print("final", final, round(dur(final), 1), "s")
for s in segs:
    print(os.path.basename(s), round(dur(s), 1))
