import * as React from "react";

/**
 * Hand-drawn avatar marks. Each component is a small, stroke-based SVG
 * that follows the same line-weight + cap/join conventions as the rest of
 * Vessel's sketch family (see SketchCircle / SketchConversation). All
 * strokes use `currentColor` so the calling component drives the color
 * via CSS — typically white when rendered over a colored avatar circle.
 *
 * Each component renders only the inner mark (no enclosing circle); the
 * caller is responsible for the colored backdrop. This keeps the icon
 * versatile across sizes and surfaces, and keeps the bundle tiny —
 * SVGs ship inline as React components, no extra HTTP requests.
 */

type IconProps = React.SVGProps<SVGSVGElement>;

const baseProps: Partial<IconProps> = {
  viewBox: "0 0 64 64",
  xmlns: "http://www.w3.org/2000/svg",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function Svg({ children, ...rest }: React.PropsWithChildren<IconProps>) {
  return (
    <svg aria-hidden="true" {...baseProps} {...rest}>
      {children}
    </svg>
  );
}

export function AvatarSmiley(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 32 Q14 14 32 13 Q50 14 50 32 Q50 50 32 51 Q14 50 14 32 Z" />
      <circle cx="25" cy="28" r="1.6" fill="currentColor" />
      <circle cx="39" cy="28" r="1.6" fill="currentColor" />
      <path d="M22 37 Q32 45 42 37" />
    </Svg>
  );
}

export function AvatarWink(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 32 Q14 14 32 13 Q50 14 50 32 Q50 50 32 51 Q14 50 14 32 Z" />
      <circle cx="25" cy="28" r="1.6" fill="currentColor" />
      <path d="M36 28 Q39 26 42 28" strokeWidth={1.8} />
      <path d="M22 38 Q30 44 40 38" />
    </Svg>
  );
}

export function AvatarBeard(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16 28 Q16 12 32 12 Q48 12 48 28 Q48 36 44 40 Q40 50 32 51 Q24 50 20 40 Q16 36 16 28 Z" />
      <path d="M22 41 Q24 47 32 49 Q40 47 42 41" strokeWidth={1.8} />
      <circle cx="26" cy="27" r="1.5" fill="currentColor" />
      <circle cx="38" cy="27" r="1.5" fill="currentColor" />
      <path d="M28 36 Q32 39 36 36" />
    </Svg>
  );
}

export function AvatarBun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="32" cy="9" r="4.5" />
      <path d="M16 32 Q16 14 32 13 Q48 14 48 32 Q48 48 32 51 Q16 48 16 32 Z" />
      <path d="M16 22 Q24 14 32 14 Q40 14 48 22" strokeWidth={1.8} opacity="0.85" />
      <circle cx="25" cy="30" r="1.6" fill="currentColor" />
      <circle cx="39" cy="30" r="1.6" fill="currentColor" />
      <path d="M24 39 Q32 44 40 39" />
    </Svg>
  );
}

export function AvatarBraids(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 32 Q14 12 32 12 Q50 12 50 32 Q50 48 32 51 Q14 48 14 32 Z" />
      <path d="M14 28 Q22 8 32 9 Q42 8 50 28" strokeWidth={1.9} />
      <path d="M14 30 Q12 40 16 50" strokeWidth={1.6} />
      <path d="M50 30 Q52 40 48 50" strokeWidth={1.6} />
      <path d="M14 38 Q11 38 12 41 Q15 41 14 44 Q11 44 13 47" strokeWidth={1.4} />
      <path d="M50 38 Q53 38 52 41 Q49 41 50 44 Q53 44 51 47" strokeWidth={1.4} />
      <circle cx="25" cy="30" r="1.6" fill="currentColor" />
      <circle cx="39" cy="30" r="1.6" fill="currentColor" />
      <path d="M24 39 Q32 44 40 39" />
    </Svg>
  );
}

export function AvatarGlasses(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 32 Q14 14 32 13 Q50 14 50 32 Q50 50 32 51 Q14 50 14 32 Z" />
      <path d="M14 18 Q24 9 32 11 Q40 9 50 18" strokeWidth={1.8} opacity="0.85" />
      <circle cx="25" cy="29" r="5" />
      <circle cx="39" cy="29" r="5" />
      <path d="M30 29 L34 29" />
      <path d="M14 27 L20 28" strokeWidth={1.6} />
      <path d="M50 27 L44 28" strokeWidth={1.6} />
      <path d="M24 39 Q32 44 40 39" />
    </Svg>
  );
}

export function AvatarCap(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16 32 Q16 18 32 17 Q48 18 48 32 Q48 50 32 51 Q16 50 16 32 Z" />
      <path d="M10 22 Q22 12 36 13 L36 22 Z" />
      <path d="M36 22 L48 22" strokeWidth={1.9} />
      <path d="M14 24 Q22 23 28 23" strokeWidth={1.5} opacity="0.6" />
      <circle cx="25" cy="33" r="1.6" fill="currentColor" />
      <circle cx="39" cy="33" r="1.6" fill="currentColor" />
      <path d="M24 41 Q32 46 40 41" />
    </Svg>
  );
}

export function AvatarHeadphones(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 34 Q14 16 32 15 Q50 16 50 34 Q50 50 32 51 Q14 50 14 34 Z" />
      <path d="M11 32 Q12 12 32 12 Q52 12 53 32" strokeWidth={2} />
      <ellipse cx="11" cy="34" rx="3.5" ry="6" />
      <ellipse cx="53" cy="34" rx="3.5" ry="6" />
      <circle cx="25" cy="30" r="1.6" fill="currentColor" />
      <circle cx="39" cy="30" r="1.6" fill="currentColor" />
      <path d="M22 39 Q32 45 42 39" />
    </Svg>
  );
}

export function AvatarMustache(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 32 Q14 14 32 13 Q50 14 50 32 Q50 50 32 51 Q14 50 14 32 Z" />
      <circle cx="25" cy="26" r="1.6" fill="currentColor" />
      <circle cx="39" cy="26" r="1.6" fill="currentColor" />
      <path d="M20 36 Q24 33 28 35 Q30 38 32 36 Q34 38 36 35 Q40 33 44 36" strokeWidth={1.9} />
      <path d="M26 42 Q32 45 38 42" strokeWidth={1.4} opacity="0.7" />
    </Svg>
  );
}

export function AvatarMug(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16 22 L44 22 L42 50 Q42 54 38 54 L22 54 Q18 54 18 50 Z" />
      <path d="M44 28 Q52 28 52 36 Q52 44 44 44" />
      <path d="M24 18 Q22 14 26 12" strokeWidth={1.6} opacity="0.8" />
      <path d="M30 18 Q28 14 32 12" strokeWidth={1.6} opacity="0.8" />
      <path d="M36 18 Q34 14 38 12" strokeWidth={1.6} opacity="0.8" />
    </Svg>
  );
}

export function AvatarMic(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="24" y="10" width="16" height="26" rx="8" />
      <line x1="27" y1="17" x2="37" y2="17" strokeWidth={1.4} opacity="0.8" />
      <line x1="27" y1="22" x2="37" y2="22" strokeWidth={1.4} opacity="0.8" />
      <line x1="27" y1="27" x2="37" y2="27" strokeWidth={1.4} opacity="0.8" />
      <path d="M18 32 Q18 44 32 44 Q46 44 46 32" />
      <line x1="32" y1="44" x2="32" y2="52" />
      <line x1="24" y1="52" x2="40" y2="52" />
    </Svg>
  );
}

export function AvatarVinyl(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="32" cy="32" r="22" />
      <circle cx="32" cy="32" r="16" opacity="0.6" />
      <circle cx="32" cy="32" r="10" opacity="0.45" />
      <circle cx="32" cy="32" r="4" />
      <circle cx="32" cy="32" r="1.4" fill="currentColor" />
    </Svg>
  );
}

export function AvatarCassette(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="8" y="18" width="48" height="28" rx="3" />
      <circle cx="22" cy="32" r="5" />
      <circle cx="42" cy="32" r="5" />
      <circle cx="22" cy="32" r="1.4" fill="currentColor" />
      <circle cx="42" cy="32" r="1.4" fill="currentColor" />
      <line x1="14" y1="42" x2="50" y2="42" strokeWidth={1.5} opacity="0.6" />
      <line x1="14" y1="22" x2="50" y2="22" strokeWidth={1.5} opacity="0.4" />
    </Svg>
  );
}

export function AvatarFox(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16 36 Q12 22 18 18 L24 28 Q32 26 40 28 L46 18 Q52 22 48 36 Q48 50 32 52 Q16 50 16 36 Z" />
      <path d="M18 22 L24 28" strokeWidth={1.5} opacity="0.7" />
      <path d="M46 22 L40 28" strokeWidth={1.5} opacity="0.7" />
      <circle cx="25" cy="34" r="1.7" fill="currentColor" />
      <circle cx="39" cy="34" r="1.7" fill="currentColor" />
      <path d="M30 41 Q32 43 34 41" />
      <path d="M28 41 L32 39 L36 41" strokeWidth={1.6} />
    </Svg>
  );
}

export function AvatarOwl(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 26 Q14 12 32 12 Q50 12 50 26 L50 42 Q50 52 32 54 Q14 52 14 42 Z" />
      <path d="M14 22 L18 14" strokeWidth={1.5} opacity="0.7" />
      <path d="M50 22 L46 14" strokeWidth={1.5} opacity="0.7" />
      <circle cx="24" cy="28" r="6" />
      <circle cx="40" cy="28" r="6" />
      <circle cx="24" cy="28" r="2" fill="currentColor" />
      <circle cx="40" cy="28" r="2" fill="currentColor" />
      <path d="M30 33 L32 36 L34 33" strokeWidth={1.6} />
      <path d="M22 44 Q24 47 28 46" strokeWidth={1.4} opacity="0.6" />
      <path d="M42 44 Q40 47 36 46" strokeWidth={1.4} opacity="0.6" />
    </Svg>
  );
}

export function AvatarStar(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M32 8 L38 24 L55 25 L42 36 L46 53 L32 44 L18 53 L22 36 L9 25 L26 24 Z" />
      <path d="M28 28 Q32 31 36 28" strokeWidth={1.5} opacity="0.7" />
    </Svg>
  );
}

export function AvatarMountain(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 50 L22 22 L32 38 L42 18 L58 50 Z" />
      <path d="M22 22 L26 28 L20 28 Z" fill="currentColor" opacity="0.7" />
      <path d="M42 18 L46 24 L40 24 Z" fill="currentColor" opacity="0.7" />
      <circle cx="14" cy="14" r="3" />
      <path d="M11 14 L17 14" strokeWidth={1.4} opacity="0.6" />
    </Svg>
  );
}

export function AvatarWave(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 38 Q14 28 22 38 T38 38 T54 38" strokeWidth={2.2} />
      <path d="M6 46 Q14 36 22 46 T38 46 T54 46" strokeWidth={1.8} opacity="0.7" />
      <path d="M10 26 Q18 18 26 24" strokeWidth={1.6} opacity="0.55" />
      <circle cx="46" cy="20" r="3.5" />
      <path d="M46 14 L46 12" strokeWidth={1.4} opacity="0.7" />
      <path d="M52 20 L54 20" strokeWidth={1.4} opacity="0.7" />
      <path d="M40 20 L38 20" strokeWidth={1.4} opacity="0.7" />
    </Svg>
  );
}

/** Stable order. The id is what's persisted in local storage; renaming
 *  an id is a breaking change to anyone who already chose that icon. */
export const AVATAR_MARKS = [
  { id: "smiley", label: "Smiley", Component: AvatarSmiley },
  { id: "wink", label: "Wink", Component: AvatarWink },
  { id: "beard", label: "Beard", Component: AvatarBeard },
  { id: "bun", label: "Top knot", Component: AvatarBun },
  { id: "braids", label: "Braids", Component: AvatarBraids },
  { id: "glasses", label: "Glasses", Component: AvatarGlasses },
  { id: "cap", label: "Cap", Component: AvatarCap },
  { id: "headphones", label: "Headphones", Component: AvatarHeadphones },
  { id: "mustache", label: "Mustache", Component: AvatarMustache },
  { id: "mug", label: "Coffee mug", Component: AvatarMug },
  { id: "mic", label: "Microphone", Component: AvatarMic },
  { id: "vinyl", label: "Vinyl", Component: AvatarVinyl },
  { id: "cassette", label: "Cassette", Component: AvatarCassette },
  { id: "fox", label: "Fox", Component: AvatarFox },
  { id: "owl", label: "Owl", Component: AvatarOwl },
  { id: "star", label: "Star", Component: AvatarStar },
  { id: "mountain", label: "Mountain", Component: AvatarMountain },
  { id: "wave", label: "Wave", Component: AvatarWave },
] as const;

export type AvatarMarkId = (typeof AVATAR_MARKS)[number]["id"];

export const AVATAR_MARK_IDS: readonly AvatarMarkId[] = AVATAR_MARKS.map(
  (m) => m.id,
);

const MARK_BY_ID: Record<string, (typeof AVATAR_MARKS)[number]> = Object.create(
  null,
);
for (const m of AVATAR_MARKS) {
  MARK_BY_ID[m.id] = m;
}

export function isAvatarMarkId(value: unknown): value is AvatarMarkId {
  return typeof value === "string" && value in MARK_BY_ID;
}

export function getAvatarMark(
  id: string | null | undefined,
): (typeof AVATAR_MARKS)[number] | null {
  if (!id || !(id in MARK_BY_ID)) return null;
  return MARK_BY_ID[id];
}
