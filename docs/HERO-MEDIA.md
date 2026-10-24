# Landing hero media

The demo window at the top of the landing page shows two people in a
session: **Maya** (host) and **Theo** (guest). Each tile looks for these
files and falls back to the avatar the real studio shows when they are
missing:

| File | Shown | Spec |
| --- | --- | --- |
| `artifacts/vessel/public/hero/host.jpg`, `guest.jpg` | Every screen | 1280×720 JPEG, about 40 to 150 KB |
| `host-talking.mp4`, `guest-talking.mp4` | Desktop, while that person holds the speaking ring | 1280×720 H.264, seamless loop, no audio, under 1 MB |
| `host-listening.mp4`, `guest-listening.mp4` | Desktop, the rest of the time | Same |

Phones, reduced-motion settings and data-saver mode get the still; the
speaking ring, meters and clock still move. The `.jpg` is the first frame of the
listening loop, so the video fades in without a jump.

While these are generated stand-ins, `ILLUSTRATIVE_MEDIA` in
`artifacts/vessel/src/components/landing/HeroDemo.tsx` stays `true` and the
page says "Illustration. Maya and Theo are not real people." under the demo.
Set it to `false` once real, consenting people replace them.

## Look

- Dark home studios at night that fall off to the page colour `#080b0f`.
- Maya's room leans warm amber, Theo's leans cool teal `#00D4AA`.
- Broadcast microphones and headphones, everyday clothes, natural skin.
- No text, logos, brand names or watermarks anywhere in frame.
- Faces sit in the centre third: the tile's name chip covers the bottom
  left and a status chip covers the top left.

## Prompts (Grok or any image model)

Generate each portrait on its own, then animate it with image-to-video.

**Maya, host, still**

```text
Photorealistic 16:9 still, webcam framing from mid-chest up, a woman around 40 hosting a podcast from her home studio at night. Warm amber practical lamp behind her left shoulder, soft teal (#00D4AA) rim light from a monitor on the right. Dark room that falls off to near-black (#080b0f) at the edges. Black broadcast microphone on a boom arm just below frame-left, over-ear headphones around her neck. Knit sweater, natural skin texture, relaxed and mid-thought, looking just off camera. Face centred in the frame with empty dark space at the bottom left. Shallow depth of field, slight film grain, no text, no logos, no brand names, no watermark. Shot on a 35mm lens at eye level, like a high-end webcam.
```

**Theo, guest, still**

```text
Photorealistic 16:9 still, webcam framing from mid-chest up, a man around 28 being interviewed on a podcast from his apartment at night. Cool teal (#00D4AA) LED strip glow behind him, a dim warm desk lamp off to the right. Dark room falling off to near-black (#080b0f). Black dynamic microphone on a small desk stand in the lower right, closed-back headphones on. Overshirt over a plain tee, natural skin texture, listening attentively with a slight smile. Face centred in the frame with empty dark space at the bottom left. Shallow depth of field, slight film grain, no text, no logos, no watermark. 35mm lens at eye level, like a high-end webcam.
```

**Either, loop (image-to-video)**

```text
Animate this image as a seamless 8-second loop, 1280x720: subtle breathing, one natural blink, a small head tilt as if listening, very slight handheld drift. Mouth stays closed. No camera cuts, no text. The first and last frames must match.
```

Mouths stay closed on purpose: lip movement is where generated video looks
fake. With real footage, record one 7.6-second loop per person that talks
for the first half and listens for the second, and offset Theo's by half
so the talker matches the speaking ring (it swaps every 3.8 s).

## Exporting

Generate one talking and one listening clip per person (the current ones
are 10 s Grok clips at 1168×784). This crops to 16:9, drops the audio and
crossfades the last second into the first so the 9 s loop has no seam:

```bash
loop() { # loop <source.mp4> <name> <crop-top-px>
  ffmpeg -y -i "$1" -filter_complex "[0:v:0]crop=1168:657:0:$3,scale=1280:720:flags=lanczos,setsar=1,fps=24,split[x][y];[x]trim=1:10,setpts=PTS-STARTPTS[a];[y]trim=0:1,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=1:offset=8,format=yuv420p[v]" \
    -map "[v]" -an -c:v libx264 -crf 27 -preset slow -profile:v high -movflags +faststart "$2.mp4"
}
loop maya-talking.mp4 host-talking 30
loop maya-listening.mp4 host-listening 30
ffmpeg -y -i host-listening.mp4 -frames:v 1 -q:v 5 host.jpg
```
