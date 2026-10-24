# Landing hero media

The demo window at the top of the landing page shows two people in a
session: **Maya** (host) and **Theo** (guest). Each tile looks for these
files and falls back to the avatar the real studio shows when they are
missing:

| File | Shown | Spec |
| --- | --- | --- |
| `artifacts/vessel/public/hero/host.jpg` | Every screen | 1280×720, JPEG, about 150 KB |
| `artifacts/vessel/public/hero/guest.jpg` | Every screen | 1280×720, JPEG, about 150 KB |
| `artifacts/vessel/public/hero/host.webm` and `host.mp4` | Desktop only | 1280×720, 8 s seamless loop, no audio, under 1.5 MB each |
| `artifacts/vessel/public/hero/guest.webm` and `guest.mp4` | Desktop only | Same as above |

Phones, reduced-motion settings and data-saver mode get the still; the
speaking ring, meters and clock still move. The `.jpg` must be the loop's
first frame so the loop fades in without a jump.

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

```bash
ffmpeg -i maya.mp4 -t 8 -vf scale=1280:720 -an -c:v libvpx-vp9 -b:v 1M host.webm
ffmpeg -i maya.mp4 -t 8 -vf scale=1280:720 -an -c:v libx264 -crf 28 -preset slow -movflags +faststart host.mp4
ffmpeg -i maya.mp4 -frames:v 1 -vf scale=1280:720 -q:v 4 host.jpg
```
