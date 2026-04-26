import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface SketchConversationProps {
  role: "host" | "guest";
  className?: string;
}

const STROKE = "#1a1a1a";
const STROKE_SOFT = "#3a3a3a";
const SW = 1.6;
const SW_FINE = 1.1;
const BG = "#fafaf4";

const LOOP = 8;

type Kf = { values: number[]; times: number[] };

const HOST_MOUTH: Kf = {
  values: [0.18, 0.18, 1, 0.32, 0.95, 0.42, 1, 0.3, 0.9, 0.45, 0.85, 0.2, 0.18, 0.18, 0.18],
  times:  [0,    0.05, 0.09, 0.13, 0.17, 0.21, 0.25, 0.29, 0.33, 0.37, 0.41, 0.45, 0.55, 0.8, 1],
};
const GUEST_MOUTH: Kf = {
  values: [0.18, 0.18, 0.18, 0.18, 1, 0.32, 0.95, 0.42, 1, 0.3, 0.9, 0.45, 0.85, 0.2, 0.18],
  times:  [0,    0.2,  0.45, 0.55, 0.59, 0.63, 0.67, 0.71, 0.75, 0.79, 0.83, 0.87, 0.91, 0.95, 1],
};

const HOST_HAND: Kf = {
  values: [0, 0, -7, 1, -9, 2, -6, 0, 0, 0, 0],
  times:  [0, 0.05, 0.13, 0.2, 0.27, 0.34, 0.4, 0.45, 0.6, 0.85, 1],
};
const GUEST_HAND: Kf = {
  values: [0, 0, 0, 7, -1, 9, -2, 6, 0, 0, 0],
  times:  [0, 0.2, 0.55, 0.6, 0.66, 0.72, 0.78, 0.84, 0.9, 0.95, 1],
};

const HOST_HEAD_NOD: Kf = {
  values: [0, 0, 0, 0, 0, 1.6, 0.2, 1.4, 0.1, 1.2, 0, 0],
  times:  [0, 0.05, 0.45, 0.5, 0.55, 0.62, 0.69, 0.76, 0.83, 0.9, 0.95, 1],
};
const GUEST_HEAD_NOD: Kf = {
  values: [0, 1.6, 0.2, 1.4, 0.1, 1.2, 0, 0, 0, 0, 0],
  times:  [0, 0.08, 0.15, 0.22, 0.29, 0.36, 0.42, 0.5, 0.7, 0.9, 1],
};

const HOST_HEAD_TILT: Kf = {
  values: [0, -1, -1.5, -1, -1.2, -1, 0, 0, 0, 0],
  times:  [0, 0.08, 0.18, 0.28, 0.38, 0.45, 0.5, 0.7, 0.9, 1],
};
const GUEST_HEAD_TILT: Kf = {
  values: [0, 0, 0, 0, 0, 1, 1.5, 1, 1.2, 0],
  times:  [0, 0.1, 0.3, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1],
};

function waveOpacity(role: "host" | "guest", offset: number): Kf {
  // Each of 3 waves pulses 0->1->0, staggered by offset (0, 0.04, 0.08)
  // Host pulses across ~0.07-0.43, Guest across ~0.57-0.93
  const start = role === "host" ? 0.07 : 0.57;
  const end = role === "host" ? 0.43 : 0.93;
  const period = 0.12;
  const values: number[] = [0];
  const times: number[] = [0];
  // Lead-in zero
  if (start > 0) {
    times.push(start);
    values.push(0);
  }
  for (let t = start + offset; t + period * 0.7 < end; t += period) {
    times.push(t);
    values.push(0);
    times.push(Math.min(t + period * 0.35, 1));
    values.push(1);
    times.push(Math.min(t + period * 0.7, 1));
    values.push(0);
  }
  times.push(end);
  values.push(0);
  if (end < 1) {
    times.push(1);
    values.push(0);
  }
  return { values, times };
}

function useLoopTransition(reduce: boolean | null) {
  return React.useMemo(
    () =>
      reduce
        ? { duration: 0 }
        : {
            duration: LOOP,
            repeat: Infinity,
            ease: "linear" as const,
          },
    [reduce],
  );
}

export function SketchConversation({ role, className }: SketchConversationProps) {
  const reduce = useReducedMotion();
  const isHost = role === "host";
  const transition = useLoopTransition(reduce);

  const mouth = isHost ? HOST_MOUTH : GUEST_MOUTH;
  const hand = isHost ? HOST_HAND : GUEST_HAND;
  const headNod = isHost ? HOST_HEAD_NOD : GUEST_HEAD_NOD;
  const headTilt = isHost ? HOST_HEAD_TILT : GUEST_HEAD_TILT;

  const wave1 = waveOpacity(role, 0);
  const wave2 = waveOpacity(role, 0.04);
  const wave3 = waveOpacity(role, 0.08);

  // For mirroring: host = mic on right, guest = mic on left. We achieve this
  // by mirroring the entire scene via transform on the inner group.
  const mirror = isHost ? "" : "translate(320 0) scale(-1 1)";

  // Helpers to bind motion props
  const animProps = (kf: Kf, kind: "scaleY" | "rotate" | "translateY" | "opacity") => {
    if (reduce) {
      // Use first value as the still-frame state.
      const v = kf.values[0];
      switch (kind) {
        case "scaleY":
          return { initial: { scaleY: v }, animate: { scaleY: v } };
        case "rotate":
          return { initial: { rotate: v }, animate: { rotate: v } };
        case "translateY":
          return { initial: { y: v }, animate: { y: v } };
        case "opacity":
          return { initial: { opacity: v }, animate: { opacity: v } };
      }
    }
    switch (kind) {
      case "scaleY":
        return {
          initial: { scaleY: kf.values[0] },
          animate: { scaleY: kf.values },
          transition: { ...transition, times: kf.times },
        };
      case "rotate":
        return {
          initial: { rotate: kf.values[0] },
          animate: { rotate: kf.values },
          transition: { ...transition, times: kf.times },
        };
      case "translateY":
        return {
          initial: { y: kf.values[0] },
          animate: { y: kf.values },
          transition: { ...transition, times: kf.times },
        };
      case "opacity":
        return {
          initial: { opacity: kf.values[0] },
          animate: { opacity: kf.values },
          transition: { ...transition, times: kf.times },
        };
    }
  };

  return (
    <svg
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid meet"
      className={cn("block w-full h-full", className)}
      role="img"
      aria-label={
        isHost
          ? "Sketch animation of a podcast host speaking into a microphone"
          : "Sketch animation of a podcast guest listening and responding"
      }
    >
      <rect x="0" y="0" width="320" height="180" fill={BG} />

      {/* Faint paper grain */}
      <g opacity="0.08" stroke={STROKE_SOFT} strokeWidth="0.4">
        <line x1="0" y1="40" x2="320" y2="41" />
        <line x1="0" y1="90" x2="320" y2="89" />
        <line x1="0" y1="140" x2="320" y2="141" />
      </g>

      <g
        transform={mirror}
        stroke={STROKE}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* Desk */}
        <path d="M 12 168 Q 80 166 160 167 T 308 168" />
        <path d="M 24 172 Q 120 173 220 171 T 304 173" opacity="0.5" strokeWidth={SW_FINE} />

        {/* Mic boom + capsule */}
        <path d="M 318 14 Q 290 38 268 60 Q 252 78 244 96" />
        <path d="M 312 18 L 308 22" strokeWidth={SW_FINE} />
        <g transform="translate(240 100)">
          <ellipse cx="0" cy="0" rx="11" ry="16" />
          <line x1="-7" y1="-9" x2="7" y2="-9" strokeWidth={SW_FINE} />
          <line x1="-8" y1="-4" x2="8" y2="-4" strokeWidth={SW_FINE} />
          <line x1="-8" y1="1" x2="8" y2="1" strokeWidth={SW_FINE} />
          <line x1="-8" y1="6" x2="8" y2="6" strokeWidth={SW_FINE} />
          <line x1="-7" y1="11" x2="7" y2="11" strokeWidth={SW_FINE} />
          <path d="M 4 -16 Q 8 -22 4 -28" strokeWidth={SW_FINE} />
          <ellipse cx="-14" cy="0" rx="3" ry="14" opacity="0.55" strokeWidth={SW_FINE} />
        </g>

        {/* Sound waves (staggered, fade in/out only during talking phase) */}
        <g>
          <motion.path
            d="M 222 78 Q 210 100 222 122"
            strokeWidth={SW_FINE}
            {...animProps(wave1, "opacity")}
          />
          <motion.path
            d="M 213 70 Q 196 100 213 130"
            strokeWidth={SW_FINE}
            {...animProps(wave2, "opacity")}
          />
          <motion.path
            d="M 204 62 Q 182 100 204 138"
            strokeWidth={SW_FINE}
            {...animProps(wave3, "opacity")}
          />
        </g>

        {/* Body */}
        <path d="M 60 170 Q 70 138 110 132 Q 138 128 160 128 Q 182 128 210 132 Q 250 138 260 170" />
        <path d="M 142 132 Q 160 144 178 132" strokeWidth={SW_FINE} />
        <path d="M 100 152 Q 110 162 122 158" strokeWidth={SW_FINE} opacity="0.55" />

        {/* Gesturing arm — pivots at the shoulder */}
        <motion.g
          style={{ transformOrigin: "210px 138px", transformBox: "view-box" } as React.CSSProperties}
          {...animProps(hand, "rotate")}
        >
          <path d="M 210 138 Q 222 150 218 168" />
          <path d="M 218 168 Q 210 158 196 156" />
          <path d="M 196 156 Q 188 154 184 158 Q 182 162 188 162 Q 194 162 196 156 Z" />
          <path d="M 188 158 L 184 156" strokeWidth={SW_FINE} />
          <path d="M 192 160 L 188 161" strokeWidth={SW_FINE} />
        </motion.g>

        {/* Head: outer group nods (translateY), inner group tilts (rotate around neck) */}
        <motion.g {...animProps(headNod, "translateY")}>
          <motion.g
            style={{ transformOrigin: "160px 116px", transformBox: "view-box" } as React.CSSProperties}
            {...animProps(headTilt, "rotate")}
          >
            {/* Neck */}
            <path d="M 150 132 L 150 116" />
            <path d="M 170 132 L 170 116" />

            {/* Head + hair */}
            <path d="M 138 92 Q 137 70 160 66 Q 183 70 182 94 Q 181 110 170 116 L 150 116 Q 139 110 138 92 Z" />
            <path d="M 140 76 Q 150 60 168 60 Q 180 62 182 74" />
            <path d="M 144 70 Q 154 64 166 64" strokeWidth={SW_FINE} />
            <path d="M 150 66 Q 158 62 164 64" strokeWidth={SW_FINE} />

            {/* Headphones */}
            <path d="M 134 80 Q 160 56 186 80" />
            <ellipse cx="186" cy="92" rx="6" ry="9" />
            <ellipse cx="134" cy="92" rx="6" ry="9" />
            <line x1="186" y1="88" x2="186" y2="96" strokeWidth={SW_FINE} />

            {/* Eyes + nose (sketched, closed-line) */}
            <path d="M 149 92 Q 152 90 156 92" strokeWidth={SW_FINE} />
            <path d="M 165 92 Q 168 90 172 92" strokeWidth={SW_FINE} />
            <path d="M 161 96 Q 159 102 162 104" strokeWidth={SW_FINE} />

            {/* Mouth: animated scaleY around its center; corner strokes
                stay so the mouth never fully disappears when collapsed. */}
            <motion.g
              style={{ transformOrigin: "160px 110px", transformBox: "view-box" } as React.CSSProperties}
              {...animProps(mouth, "scaleY")}
            >
              <ellipse cx="160" cy="110" rx="5" ry="3.5" fill={STROKE} stroke="none" />
            </motion.g>
            <path d="M 155 110.5 L 156 111" strokeWidth={SW_FINE} />
            <path d="M 164 111 L 165 110.5" strokeWidth={SW_FINE} />

            {/* Eyebrows */}
            <path d="M 148 86 Q 152 84 157 86" strokeWidth={SW_FINE} opacity="0.7" />
            <path d="M 164 86 Q 168 84 172 86" strokeWidth={SW_FINE} opacity="0.7" />
          </motion.g>
        </motion.g>
      </g>
    </svg>
  );
}

export function SketchHost(props: Omit<SketchConversationProps, "role">) {
  return <SketchConversation role="host" {...props} />;
}

export function SketchGuest(props: Omit<SketchConversationProps, "role">) {
  return <SketchConversation role="guest" {...props} />;
}
