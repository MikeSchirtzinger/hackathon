#!/usr/bin/env python3
"""Concept cut: no side panel, only minimal notifications and proactive agents. Rendered frame by frame with PIL."""
import subprocess, os, math, textwrap
from PIL import Image, ImageDraw, ImageFont, ImageFilter

V = os.path.dirname(os.path.abspath(__file__))
SRC, AUD, FR, OUT = [os.path.join(V, d) for d in ("src", "audio2", "frames2", "out")]
for d in (FR, OUT):
    os.makedirs(d, exist_ok=True)
W, H, FPS = 1920, 1080, 30
BG = (12, 14, 22)
SERIF = "/System/Library/Fonts/Supplemental/Georgia.ttf"
SANS = "/System/Library/Fonts/HelveticaNeue.ttc"
PAD = 0.9
KIND = {  # chip label and colour per attention class
    "quiet": ("Quiet status", (110, 170, 120)),
    "digest": ("Return digest", (110, 150, 200)),
    "queue": ("Review queue", (215, 170, 90)),
    "interrupt": ("Interrupt", (225, 110, 100)),
    "agent": ("Agent speech", (180, 130, 220)),
    "tracked": ("Tracked", (110, 150, 200)),
    "escalated": ("Escalated", (225, 110, 100)),
}
_fonts = {}


def F(path, size):
    k = (path, size)
    if k not in _fonts:
        _fonts[k] = ImageFont.truetype(path, size)
    return _fonts[k]


def dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p],
                                capture_output=True, text=True).stdout.strip())


def ease(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def fit_bg(path, dim=0.0):
    im = Image.open(path).convert("RGB")
    s = max(W / im.width, H / im.height)
    im = im.resize((int(im.width * s) + 1, int(im.height * s) + 1), Image.LANCZOS)
    im = im.crop(((im.width - W) // 2, (im.height - H) // 2, (im.width - W) // 2 + W, (im.height - H) // 2 + H))
    if dim:
        im = Image.blend(im, Image.new("RGB", (W, H), BG), dim)
    return im


def wrap(d, text, font, maxw):
    lines, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if d.textlength(t, font=font) <= maxw:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


class Toast:
    """A notification card that slides in from the right edge and fades out."""
    def __init__(self, start, end, title, body, kind, y=64, x=None, width=560, meta=None):
        self.start, self.end, self.title, self.body, self.kind = start, end, title, body, kind
        self.y, self.width, self.meta = y, width, meta
        self.x = x

    def draw(self, layer, t):
        if t < self.start or t > self.end + 0.5:
            return
        a_in = ease((t - self.start) / 0.45)
        a_out = 1 - ease((t - self.end) / 0.5) if t > self.end else 1
        alpha = a_in * a_out
        d = ImageDraw.Draw(layer)
        ft, fb, fc = F(SANS, 30), F(SANS, 25), F(SANS, 21)
        lines = wrap(d, self.body, fb, self.width - 56)
        h = 28 + 40 + len(lines) * 32 + 22 + (34 if self.meta else 0) + 34
        x = (self.x if self.x is not None else W - self.width - 64) + int((1 - a_in) * 80)
        y = self.y
        card = Image.new("RGBA", (self.width, h), (0, 0, 0, 0))
        cd = ImageDraw.Draw(card)
        cd.rounded_rectangle((0, 0, self.width - 1, h - 1), radius=18, fill=(22, 25, 36, 236), outline=(60, 64, 80, 255))
        label, col = KIND[self.kind]
        cd.ellipse((24, 30, 38, 44), fill=col)
        cd.text((52, 22), self.title, font=ft, fill=(245, 242, 235))
        yy = 68
        for ln in lines:
            cd.text((28, yy), ln, font=fb, fill=(190, 192, 200))
            yy += 32
        yy += 8
        if self.meta:
            cd.text((28, yy), self.meta, font=fc, fill=(140, 142, 152))
            yy += 34
        tw = cd.textlength(label, font=fc)
        cd.rounded_rectangle((28, yy, 28 + tw + 24, yy + 30), radius=8, fill=col + (60,), outline=col + (200,))
        cd.text((40, yy + 4), label, font=fc, fill=col)
        if alpha < 1:
            a = card.split()[3].point(lambda v: int(v * alpha))
            card.putalpha(a)
        layer.alpha_composite(card, (x, y))


class Caption:
    def __init__(self, text, start=0.0):
        self.text, self.start = text, start

    def draw(self, layer, t):
        if t < self.start:
            return
        alpha = ease((t - self.start) / 0.4)
        d = ImageDraw.Draw(layer)
        f = F(SANS, 40)
        tw = d.textlength(self.text, font=f)
        x0, y0 = 96, H - 168
        col = (13, 16, 26, int(222 * alpha))
        d.rounded_rectangle((x0, y0, x0 + tw + 64, y0 + 88), radius=14, fill=col)
        d.text((x0 + 32, y0 + 20), self.text, font=f, fill=(245, 240, 230, int(255 * alpha)))


class Pill:
    """Small persistent status pill, bottom left."""
    def __init__(self, text, start, end, col=(110, 170, 120), pulse=True, x=96, y=H - 236):
        self.text, self.start, self.end, self.col, self.pulse = text, start, end, col, pulse
        self.x0, self.y0 = x, y

    def draw(self, layer, t):
        if t < self.start or t > self.end:
            return
        d = ImageDraw.Draw(layer)
        f = F(SANS, 24)
        tw = d.textlength(self.text, font=f)
        x0, y0 = self.x0, self.y0
        d.rounded_rectangle((x0, y0, x0 + tw + 60, y0 + 46), radius=23, fill=(22, 25, 36, 230), outline=(60, 64, 80, 255))
        r = 7 + (2 * math.sin(t * 4) if self.pulse else 0)
        d.ellipse((x0 + 18 - r + 7, y0 + 23 - r, x0 + 18 + r + 7, y0 + 23 + r), fill=self.col)
        d.text((x0 + 44, y0 + 9), self.text, font=f, fill=(220, 222, 230))


class Tag:
    def __init__(self, text):
        self.text = text

    def draw(self, layer, t):
        d = ImageDraw.Draw(layer)
        f = F(SANS, 24)
        tw = d.textlength(self.text, font=f)
        d.rounded_rectangle((64, 40, 64 + tw + 40, 88), radius=10, fill=(13, 16, 26, 200))
        d.text((84, 50), self.text, font=f, fill=(220, 180, 110))


class Headline:
    def __init__(self, lines, sub=None, foot=None, x=140, y=370):
        self.lines, self.sub, self.foot, self.x, self.y = lines, sub, foot, x, y

    def draw(self, layer, t):
        d = ImageDraw.Draw(layer)
        y = self.y
        for i, ln in enumerate(self.lines):
            a = ease((t - 0.15 * i) / 0.6)
            d.text((self.x, y), ln, font=F(SERIF, 108), fill=(245, 240, 230, int(255 * a)))
            y += 118
        if self.sub:
            a = ease((t - 0.5) / 0.6)
            d.text((self.x + 4, y + 18), self.sub, font=F(SANS, 40), fill=(200, 196, 186, int(255 * a)))
        if self.foot:
            d.text((self.x + 4, H - 110), self.foot, font=F(SANS, 28), fill=(150, 148, 140, 255))


class Transcript:
    """Two chat-like lines: a human question and an agent answer, centred."""
    def __init__(self, q, a, start, y=300):
        self.q, self.a, self.start, self.y = q, a, start, y

    def draw(self, layer, t):
        if t < self.start:
            return
        d = ImageDraw.Draw(layer)
        fq, fa, fl = F(SANS, 34), F(SERIF, 38), F(SANS, 22)
        x0, w = 300, 1320
        a1 = ease((t - self.start) / 0.5)
        ql = wrap(d, self.q, fq, w - 60)
        d.text((x0, self.y), "TEAMMATE", font=fl, fill=(150, 152, 162, int(255 * a1)))
        yy = self.y + 36
        for ln in ql:
            d.text((x0, yy), ln, font=fq, fill=(215, 216, 224, int(255 * a1)))
            yy += 44
        a2 = ease((t - self.start - 1.6) / 0.6)
        if a2 > 0:
            yy += 40
            col = KIND["agent"][1]
            d.text((x0, yy), "SPARK, SPEAKING FOR MIKE", font=fl, fill=col + (int(255 * a2),))
            yy += 36
            for ln in wrap(d, self.a, fa, w - 60):
                d.text((x0, yy), ln, font=fa, fill=(245, 240, 230, int(255 * a2)))
                yy += 50


def render_scene(name, length, bg, elements, audio):
    out = os.path.join(FR, name + ".mp4")
    n = int(length * FPS)
    ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
                           "-i", "-", "-i", audio, "-filter_complex", f"[1:a]apad,atrim=duration={length}[a]",
                           "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", out], stdin=subprocess.PIPE)
    base = bg if isinstance(bg, Image.Image) else Image.new("RGB", (W, H), bg)
    for i in range(n):
        t = i / FPS
        frame = base.copy()
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for e in elements:
            e.draw(layer, t)
        frame = Image.alpha_composite(frame.convert("RGBA"), layer).convert("RGB")
        # fade edges
        fade = min(1.0, t / 0.35, (length - t) / 0.35)
        if fade < 1:
            frame = Image.blend(Image.new("RGB", (W, H), (0, 0, 0)), frame, max(0.0, fade))
        ff.stdin.write(frame.tobytes())
    ff.stdin.close()
    ff.wait()
    return out


def a(i):
    return os.path.join(AUD, f"c{i}.wav")


bgimg = fit_bg(os.path.join(SRC, "bg-higgsfield.png"))
meet = fit_bg(os.path.join(SRC, "meet-brevity.jpg"))
crm = fit_bg(os.path.join(SRC, "ambiguous-crm.jpg"), dim=0.15)
cal = fit_bg(os.path.join(SRC, "ambiguous-calendar.jpg"), dim=0.35)
tasks = fit_bg(os.path.join(SRC, "ambiguous-tasks.jpg"), dim=0.1)
doc = fit_bg(os.path.join(SRC, "ambiguous-doc.jpg"), dim=0.1)
dark = Image.new("RGB", (W, H), BG)
concept = Tag("Concept")
segs = []

L = dur(a(0)) + PAD
segs.append(render_scene("00", L, bgimg, [Headline(["Spark"], "Proactive agents with an attention model.",
                                                   "Concept cut  ·  Brevity  ·  September 2026")], a(0)))

L = dur(a(1)) + PAD
segs.append(render_scene("01", L, meet, [
    concept,
    Toast(2.2, L, "Note saved", "Tool of interest. Bring it to the project meeting.", "quiet",
          meta="meet.brevity.ventures  ·  page text captured  ·  local"),
    Caption("One hotkey. Page context comes with the note.", 0.6)], a(1)))

L = dur(a(2)) + PAD
segs.append(render_scene("02", L, crm, [
    concept,
    Toast(1.4, L, "Filed for later", "Check whether Bluefin needs per-workspace opt-out before the proposal call.", "digest",
          meta="Linked to: Bluefin team plan  ·  resurfaces at your next review"),
    Caption("Same hotkey. Tracked behind the scenes.", 0.5)], a(2)))

L = dur(a(3)) + PAD
segs.append(render_scene("03", L, dark, [
    concept,
    Headline(["Attention model"], None, None, x=140, y=120),
    Toast(1.2, L, "Note saved", "Local write finished. No focus taken.", "quiet", y=330, x=140, width=760),
    Toast(2.6, L, "Summary ready", "Useful, no decision needed. Shown when you return.", "digest", y=330, x=1000, width=760),
    Toast(4.0, L, "Approval needed, can wait", "Queued with a resurface trigger.", "queue", y=640, x=140, width=760),
    Toast(5.4, L, "Meeting in 10 minutes", "The one thing that earns an interruption.", "interrupt", y=640, x=1000, width=760),
    Caption("What it is. Which work. When it deserves attention. What it may do.", 6.8)], a(3)))

L = dur(a(4)) + PAD
segs.append(render_scene("04", L, cal, [
    concept,
    Toast(1.0, L, "Project meeting: onboarding redesign", "Starts in 10 minutes.  Join  ·  meet.jit.si/ambi-d2b2…", "interrupt",
          y=120, x=560, width=800, meta="1 tagged note attached: meet.brevity.ventures"),
    Caption("From the real Ambiguous event. Link and note attached.", 0.5)], a(4)))

L = dur(a(5)) + PAD
segs.append(render_scene("05", L, dark, [
    concept,
    Pill("Spark  ·  listening on device", 0, L),
    Toast(1.2, L, "You stepped away", "Takeover active. Answer from tagged context. Queue new commitments.", "queue", meta="Absence marked 4:12 PM"),
    Transcript("What was Mike's pick for onboarding, and can we commit to shipping it before the SSO change?",
               "Mike tagged the Brevity Meet seat-key flow: one email, key shown once, agents propose and only the person's seat approves. Ordering against SSO is a new commitment, so I am queueing it for Mike.", 4.0),
    Caption("Answers from the page you tagged. Commitments wait for you.", 9.5)], a(5)))

L = dur(a(6)) + PAD
segs.append(render_scene("06", L, dark, [
    concept,
    Pill("Spark  ·  listening on device", 0, L),
    Toast(0.8, L, "Welcome back", "Speech stopped. Transcription never did.", "quiet", y=100, x=280, width=1360),
    Toast(2.0, L, "While you were away", "Teammate asked about the onboarding pick. Analytics owner still open.", "digest", y=300, x=280, width=1360,
          meta="4:12 PM to 4:19 PM  ·  no capture gaps"),
    Toast(3.2, L, "What Spark said", "Quoted the seat-key flow from meet.brevity.ventures. Did not commit to the SSO ordering.", "agent", y=500, x=280, width=1360),
    Toast(4.4, L, "Needs you", "Ship seat-key onboarding before the SSO change?", "queue", y=700, x=280, width=1360,
          meta="Evidence: transcript 4:14 PM  ·  tagged page"),
    ], a(6)))

L = dur(a(7)) + PAD
segs.append(render_scene("07", L, dark, [
    concept,
    Headline(["Meeting ended.", "Proactive agent running."], None, None, x=140, y=110),
    Pill("3 agents working  ·  1 escalation", 0.5, L, col=(215, 170, 90), x=1440, y=44),
    Toast(2.0, L, "Claude Code  ·  local", "Drafting the analytics event spec from the transcript and the tagged page.", "tracked",
          y=420, x=140, width=800, meta="Runs on your machine  ·  no transcript leaves it"),
    Toast(3.4, L, "Ambiguous agent", "Preparing the Bluefin follow-up with the per-workspace opt-out answer.", "tracked",
          y=420, x=980, width=800, meta="Workspace: Spark  ·  CRM deal: Bluefin team plan"),
    Toast(5.0, L, "Ambiguous agent", "Summary document drafted with evidence references.", "tracked",
          y=700, x=140, width=800, meta="Doc: Recall demo, Q4 onboarding redesign"),
    Toast(6.6, L, "Escalated to you", "Ship seat-key onboarding before the SSO change? Two agents are blocked on it.", "escalated",
          y=700, x=980, width=800, meta="Asked once. Will not re-notify."),
    ], a(7)))

L = dur(a(8)) + PAD
segs.append(render_scene("08", L, tasks, [
    concept,
    Toast(1.2, L, "Synced after review", "Summary and 3 tasks, each with evidence. Resume links attached.", "quiet",
          meta="Nothing synced without your selection"),
    Caption("Results in Ambiguous. Resume opens context, not action.", 0.5)], a(8)))

L = dur(a(9)) + PAD
segs.append(render_scene("09", L, bgimg, [Headline(["Escalates what matters.", "Tracks the rest."],
                                                   "Spark. Proactive agents with an attention model.",
                                                   "github.com/MikeSchirtzinger/spark  ·  concept cut")], a(9)))

lst = os.path.join(FR, "list.txt")
with open(lst, "w") as f:
    for s in segs:
        f.write(f"file '{s}'\n")
final = os.path.join(OUT, "spark-concept.mp4")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", final], check=True)
print("final", final, round(dur(final), 1), "s")
