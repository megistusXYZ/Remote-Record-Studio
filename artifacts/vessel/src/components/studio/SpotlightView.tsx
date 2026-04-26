import { useCallback, useEffect, useRef, useState } from "react";
import { MicOff, Maximize2 } from "lucide-react";
import { AvatarMark } from "../AvatarMark";
import { cn } from "@/lib/utils";

/**
 * "Loom-style" spotlight layout shown whenever a participant is broadcasting
 * a screen-share feed. The shared screen is the visual hero (letterboxed,
 * never cropped) and every connected participant — including the sharer —
 * appears in a slim filmstrip beneath it. The sharer's own webcam is also
 * pinned over the hero as a draggable circular "PiP" bubble so a viewer can
 * see the presenter while reading their slides.
 *
 * Bubble interaction model:
 *   • Drag with the mouse / touch to reposition. On release we snap to the
 *     nearest corner of the spotlight area so the bubble never ends up
 *     covering an awkward spot.
 *   • Arrow keys (when the bubble has focus) cycle to the corner in that
 *     direction, mirroring the snap behaviour for keyboard users.
 *   • Enter / Space toggles the bubble's visibility — handy when the
 *     sharer wants a fully-clean recording for a moment.
 *   • The chosen corner is persisted in localStorage so subsequent shares
 *     remember the user's preference.
 */

export type SpotlightTile = {
  /** Stable id used for keys + telemetry. */
  id: string;
  pubkey: string;
  displayName: string;
  /** True for the local participant (used to mute the <audio> track and
   *  show the "LOCAL" badge). */
  isLocal: boolean;
  /** True iff this tile belongs to the participant currently sharing. */
  isSharer: boolean;
  /** Camera stream — may be null while the participant has their camera
   *  off or is still warming up. */
  cameraStream: MediaStream | null | undefined;
  micEnabled: boolean;
  cameraEnabled: boolean;
  /** True only for remote tiles whose first frame hasn't decoded yet. */
  isConnecting: boolean;
};

export type SpotlightViewProps = {
  /** The shared-screen MediaStream, hero of the layout. */
  screenStream: MediaStream;
  /** True iff the screen feed is the local user's own capture (so we mute
   *  its audio playback to avoid a loopback echo). */
  screenIsLocal: boolean;
  /** All participant tiles to render — sharer first is fine, the layout
   *  doesn't care about order, but the caller usually puts the sharer at
   *  index 0 for visual consistency. */
  tiles: SpotlightTile[];
  /** The presenter (sharer) — used to render the floating webcam bubble.
   *  When null the bubble is hidden (e.g. the sharer has their camera off). */
  presenter: SpotlightTile | null;
  /** Live mic level for the local participant (0..1). Bubbles in the
   *  filmstrip use a fixed 0.5 fallback for remotes. */
  myMicLevel: number;
};

type Corner = "tl" | "tr" | "bl" | "br";

const BUBBLE_CORNER_KEY = "vessel.screen-share.bubble-corner";
const BUBBLE_VISIBLE_KEY = "vessel.screen-share.bubble-visible";

function loadCorner(): Corner {
  if (typeof window === "undefined") return "br";
  try {
    const v = window.localStorage.getItem(BUBBLE_CORNER_KEY);
    if (v === "tl" || v === "tr" || v === "bl" || v === "br") return v;
  } catch {
    // ignore
  }
  return "br";
}

function loadVisible(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(BUBBLE_VISIBLE_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveCorner(c: Corner) {
  try {
    window.localStorage.setItem(BUBBLE_CORNER_KEY, c);
  } catch {
    // ignore
  }
}

function saveVisible(v: boolean) {
  try {
    window.localStorage.setItem(BUBBLE_VISIBLE_KEY, v ? "1" : "0");
  } catch {
    // ignore
  }
}

/** Map an absolute (x,y) inside the hero box to the nearest corner. */
function nearestCorner(
  x: number,
  y: number,
  width: number,
  height: number,
): Corner {
  const left = x < width / 2;
  const top = y < height / 2;
  if (top && left) return "tl";
  if (top && !left) return "tr";
  if (!top && left) return "bl";
  return "br";
}

function HeroVideo({
  stream,
  muted,
}: {
  stream: MediaStream;
  muted: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      // object-contain preserves the captured aspect ratio so a 16:10
      // monitor doesn't get sliced into a 16:9 box. Black bars are fine —
      // they communicate "what you see is exactly what they see".
      className="w-full h-full object-contain bg-black"
    />
  );
}

function FilmstripTile({ tile }: { tile: SpotlightTile }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && tile.cameraStream) {
      ref.current.srcObject = tile.cameraStream;
    }
  }, [tile.cameraStream]);
  return (
    <div
      data-testid={`spotlight-film-${tile.id}`}
      className={cn(
        "relative shrink-0 w-32 sm:w-40 aspect-video rounded-lg overflow-hidden bg-vessel-bg-surface border border-vessel-border",
        tile.isSharer && "ring-2 ring-vessel-accent/70",
        !tile.micEnabled && "outline outline-1 outline-vessel-red/50 outline-offset-[-1px]",
      )}
    >
      {tile.isConnecting ? (
        <div className="absolute inset-0 flex items-center justify-center bg-vessel-bg-surface">
          <span className="font-mono-vessel text-[10px] text-vessel-text-secondary">
            Connecting…
          </span>
        </div>
      ) : (
        <>
          {/* Keep the <video> mounted whenever a stream exists, even
              while the camera is disabled — see the matching note in
              VideoTile. Tearing it down on every camera-off forces a
              fresh stream attach + keyframe wait, which manifests as
              a long black gap before the camera reappears. */}
          {tile.cameraStream && (
            <video
              ref={ref}
              autoPlay
              playsInline
              muted={tile.isLocal}
              className={cn(
                "absolute inset-0 w-full h-full object-cover",
                !tile.cameraEnabled && "invisible",
              )}
            />
          )}
          {(!tile.cameraStream || !tile.cameraEnabled) && (
            <div className="absolute inset-0 flex items-center justify-center bg-vessel-bg-elevated">
              <AvatarMark
                pubkey={tile.pubkey}
                displayName={tile.displayName}
                className="w-10 h-10 sm:w-12 sm:h-12"
                initialsClassName="text-xs"
              />
            </div>
          )}
        </>
      )}
      <div className="absolute bottom-1 left-1 right-1 flex items-center gap-1 z-10">
        <div className="bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded-md min-w-0 flex-1">
          <span className="text-[10px] font-medium text-white truncate block">
            {tile.isLocal ? "You" : tile.displayName}
          </span>
        </div>
        {!tile.micEnabled && (
          <div className="shrink-0 w-4 h-4 bg-vessel-red/30 border border-vessel-red/50 rounded-full flex items-center justify-center">
            <MicOff className="w-2.5 h-2.5 text-vessel-red" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Floating circular webcam bubble overlaying the screen-share hero.
 * Owns its own drag + keyboard handling; the parent only feeds it the
 * presenter's stream + display details.
 */
function PresenterBubble({
  presenter,
  containerRef,
}: {
  presenter: SpotlightTile;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [corner, setCorner] = useState<Corner>(() => loadCorner());
  const [visible, setVisible] = useState<boolean>(() => loadVisible());
  // Free-position offset (pixels) used during an active drag. When the
  // drag ends we snap to the nearest corner and clear this back to null,
  // so the corner-anchored CSS classes take over again.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && presenter.cameraStream) {
      videoRef.current.srcObject = presenter.cameraStream;
    }
  }, [presenter.cameraStream]);

  useEffect(() => {
    saveCorner(corner);
  }, [corner]);
  useEffect(() => {
    saveVisible(visible);
  }, [visible]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const node = bubbleRef.current;
    const container = containerRef.current;
    if (!node || !container) return;
    const nodeRect = node.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - nodeRect.left,
      offsetY: e.clientY - nodeRect.top,
    };
    try {
      node.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    // Seed dragPos at the current rendered position so the bubble doesn't
    // jump on the first pointermove tick.
    setDragPos({
      x: nodeRect.left - containerRect.left,
      y: nodeRect.top - containerRect.top,
    });
  }, [containerRef]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    const container = containerRef.current;
    const node = bubbleRef.current;
    if (!state || !container || !node) return;
    if (state.pointerId !== e.pointerId) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    let x = e.clientX - containerRect.left - state.offsetX;
    let y = e.clientY - containerRect.top - state.offsetY;
    // Clamp inside the hero so the bubble can't be lost off-screen.
    const maxX = Math.max(0, containerRect.width - nodeRect.width);
    const maxY = Math.max(0, containerRect.height - nodeRect.height);
    if (x < 0) x = 0;
    if (x > maxX) x = maxX;
    if (y < 0) y = 0;
    if (y > maxY) y = maxY;
    setDragPos({ x, y });
  }, [containerRef]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    const container = containerRef.current;
    const node = bubbleRef.current;
    if (!state || !container || !node) return;
    if (state.pointerId !== e.pointerId) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    // Use the bubble's center for nearest-corner detection so the snap
    // feels natural even when the user drops the bubble straddling a
    // midline.
    const cx = nodeRect.left - containerRect.left + nodeRect.width / 2;
    const cy = nodeRect.top - containerRect.top + nodeRect.height / 2;
    setCorner(nearestCorner(cx, cy, containerRect.width, containerRect.height));
    setDragPos(null);
    try {
      node.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    dragStateRef.current = null;
  }, [containerRef]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "Enter":
      case " ": {
        e.preventDefault();
        setVisible((v) => !v);
        return;
      }
      case "ArrowUp": {
        e.preventDefault();
        setCorner((c) => (c === "bl" ? "tl" : c === "br" ? "tr" : c));
        return;
      }
      case "ArrowDown": {
        e.preventDefault();
        setCorner((c) => (c === "tl" ? "bl" : c === "tr" ? "br" : c));
        return;
      }
      case "ArrowLeft": {
        e.preventDefault();
        setCorner((c) => (c === "tr" ? "tl" : c === "br" ? "bl" : c));
        return;
      }
      case "ArrowRight": {
        e.preventDefault();
        setCorner((c) => (c === "tl" ? "tr" : c === "bl" ? "br" : c));
        return;
      }
      default:
        return;
    }
  }, []);

  // Hidden state collapses into a tiny pill in the bottom-right that the
  // user (or anyone with a keyboard) can re-expand without losing their
  // place. Stays at the saved corner so it pops back where they expect.
  if (!visible) {
    return (
      <button
        type="button"
        data-testid="button-show-presenter-bubble"
        onClick={() => setVisible(true)}
        className={cn(
          "absolute z-30 flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 text-[10px] font-mono-vessel text-white/80 hover:text-white",
          corner === "tl" && "top-3 left-3",
          corner === "tr" && "top-3 right-3",
          corner === "bl" && "bottom-3 left-3",
          corner === "br" && "bottom-3 right-3",
        )}
        aria-label="Show presenter camera bubble"
      >
        <Maximize2 className="w-3 h-3" />
        Show camera
      </button>
    );
  }

  // While dragging we render with absolute pixel coords; otherwise the
  // bubble is anchored to one of the four corners so window resizes
  // keep it visually pinned.
  const cornerClasses = dragPos
    ? ""
    : cn(
        corner === "tl" && "top-4 left-4",
        corner === "tr" && "top-4 right-4",
        corner === "bl" && "bottom-4 left-4",
        corner === "br" && "bottom-4 right-4",
      );

  return (
    <div
      ref={bubbleRef}
      data-testid="presenter-bubble"
      role="button"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      style={
        dragPos
          ? { left: `${dragPos.x}px`, top: `${dragPos.y}px` }
          : undefined
      }
      className={cn(
        "absolute z-30 w-28 h-28 sm:w-36 sm:h-36 rounded-full overflow-hidden border-2 border-vessel-accent/70 shadow-2xl bg-vessel-bg-surface cursor-grab active:cursor-grabbing select-none focus:outline-none focus:ring-2 focus:ring-vessel-accent",
        cornerClasses,
      )}
      aria-label={`${presenter.displayName} camera (drag to reposition, arrow keys to snap to a corner, Enter to hide)`}
    >
      {/* Same keep-mounted pattern as VideoTile / FilmstripTile —
          unmounting the <video> on every camera-off forces a stream
          re-attach + keyframe wait when toggling back on, producing a
          long black gap. Avatar overlays the (blanked) video instead. */}
      {presenter.cameraStream && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={presenter.isLocal}
          className={cn(
            "absolute inset-0 w-full h-full object-cover",
            !presenter.cameraEnabled && "invisible",
          )}
        />
      )}
      {(!presenter.cameraStream || !presenter.cameraEnabled) && (
        <div className="absolute inset-0 flex items-center justify-center bg-vessel-bg-elevated">
          <AvatarMark
            pubkey={presenter.pubkey}
            displayName={presenter.displayName}
            className="w-16 h-16 sm:w-20 sm:h-20"
            initialsClassName="text-lg"
          />
        </div>
      )}
      <div className="absolute bottom-1 left-1 right-1 flex items-center justify-center gap-1 z-10 pointer-events-none">
        <div className="bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded-full min-w-0">
          <span className="text-[10px] font-medium text-white truncate block">
            {presenter.isLocal ? "You" : presenter.displayName}
          </span>
        </div>
        {!presenter.micEnabled && (
          <div className="shrink-0 w-4 h-4 bg-vessel-red/30 border border-vessel-red/50 rounded-full flex items-center justify-center">
            <MicOff className="w-2.5 h-2.5 text-vessel-red" />
          </div>
        )}
      </div>
    </div>
  );
}

export function SpotlightView({
  screenStream,
  screenIsLocal,
  tiles,
  presenter,
}: SpotlightViewProps) {
  const heroRef = useRef<HTMLDivElement>(null);
  return (
    <div
      data-testid="spotlight-view"
      className="w-full h-full p-3 sm:p-4 lg:p-5 flex flex-col gap-3"
    >
      <div
        ref={heroRef}
        className="relative flex-1 min-h-0 rounded-2xl overflow-hidden border border-vessel-border bg-black"
      >
        <HeroVideo stream={screenStream} muted={screenIsLocal} />
        <div className="absolute top-3 left-3 z-20 bg-vessel-accent/20 border border-vessel-accent/40 px-2 py-0.5 rounded-md pointer-events-none">
          <span className="text-[10px] font-mono-vessel font-bold text-vessel-accent uppercase tracking-wider">
            Screen share
          </span>
        </div>
        {presenter && (
          <PresenterBubble presenter={presenter} containerRef={heroRef} />
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2 overflow-x-auto pb-1">
        {tiles.map((t) => (
          <FilmstripTile key={t.id} tile={t} />
        ))}
      </div>
    </div>
  );
}
