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

While these are illustrative stand-ins, `ILLUSTRATIVE_MEDIA` in
`artifacts/vessel/src/components/landing/HeroDemo.tsx` stays `true` and the
page says "Illustration. Maya and Theo are not real people." under the demo.
Set it to `false` once real, consenting people replace them.

## Exporting

Supply one talking and one listening clip per person. For a 10 s source at
1168×784, this crops to 16:9, drops the audio and
crossfades the last second into the first so the 9 s loop has no seam:

```bash
loop() { # loop <source.mp4> <name> <crop-top-px>
  ffmpeg -y -i "$1" -filter_complex "[0:v:0]crop=1168:657:0:$3,scale=1280:720:flags=lanczos,setsar=1,fps=24,split[x][y];[x]trim=1:10,setpts=PTS-STARTPTS[a];[y]trim=0:1,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=1:offset=8,format=yuv420p[v]" \
    -map "[v]" -an -c:v libx264 -crf 27 -preset slow -profile:v high -movflags +faststart "$2.mp4"
}
loop source-talking.mp4 host-talking 30
loop source-listening.mp4 host-listening 30
ffmpeg -y -i host-listening.mp4 -frames:v 1 -q:v 5 host.jpg
```
