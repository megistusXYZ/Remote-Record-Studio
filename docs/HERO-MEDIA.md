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
loop source-talking.mp4 host-talking 45
ffmpeg -y -i source-talking.mp4 -frames:v 1 -vf "crop=1168:657:0:45,scale=1280:720:flags=lanczos" -q:v 3 host.jpg
```

Without a listening clip, make one from the still: a 9 s loop that breathes
in and out by 2%, starting and ending on the still, so the swap from the
talking loop has no jump:

```bash
ffmpeg -y -loop 1 -framerate 24 -i host.jpg \
  -vf "scale=2560:1440:flags=lanczos,zoompan=z='1+0.02*(1-cos(2*PI*on/216))/2':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=24,format=yuv420p" \
  -frames:v 216 -an -c:v libx264 -crf 27 -preset slow -profile:v high -movflags +faststart host-listening.mp4
```

Keep each loop under 1 MB (raise `-crf` a step if not). The current set is
the "pirate radio" look: two studios built inside a ship, warm lantern on
one side and teal light on the other, mid-tones lifted so the tiles sit well
on both the dark and the light page.
