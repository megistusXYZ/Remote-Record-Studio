import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useIdentity } from "../hooks/use-identity";
import { Layout } from "../components/layout";
import { Input } from "@/components/ui/input";
import { useCreateSession } from "@workspace/api-client-react";
import { Mic, ArrowRight, Users, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const ROOM_SIZE_MIN = 1;
const ROOM_SIZE_MAX = 25;
const DEFAULT_ROOM_SIZE = 8;

type RoomPreset = { value: number; label: string; sub: string } | { value: "custom"; label: string; sub: string };

const ROOM_PRESETS: RoomPreset[] = [
  { value: 2, label: "Two of us", sub: "Interview" },
  { value: 4, label: "Up to 4", sub: "Panel" },
  { value: 8, label: "Up to 8", sub: "Group" },
  { value: "custom", label: "Custom", sub: "1–25" },
];

export default function NewSession() {
  const [, setLocation] = useLocation();
  const { pubkey, displayName, isLoaded } = useIdentity();

  const [title, setTitle] = useState("");
  const [roomSize, setRoomSize] = useState<number>(DEFAULT_ROOM_SIZE);
  const [isCustom, setIsCustom] = useState(false);
  const [customInput, setCustomInput] = useState<string>(String(DEFAULT_ROOM_SIZE));

  const createSessionMutation = useCreateSession();

  useEffect(() => {
    if (isLoaded && (!pubkey || !displayName)) setLocation("/");
  }, [isLoaded, pubkey, displayName, setLocation]);

  if (!isLoaded) return null;
  if (!pubkey || !displayName) return null;

  const effectiveSize = isCustom
    ? clampRoomSize(parseInt(customInput, 10))
    : roomSize;

  const handlePresetClick = (preset: RoomPreset) => {
    if (preset.value === "custom") {
      setIsCustom(true);
      setCustomInput(String(roomSize));
    } else {
      setIsCustom(false);
      setRoomSize(preset.value);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || createSessionMutation.isPending) return;

    try {
      const session = await createSessionMutation.mutateAsync({
        data: {
          title: title.trim(),
          hostPubkey: pubkey,
          hostName: displayName,
          maxParticipants: effectiveSize,
        },
      });
      setLocation(`/session/${session.id}`);
    } catch (error) {
      console.error("Failed to create session:", error);
    }
  };

  return (
    <Layout>
      <TooltipProvider>
        <div className="container mx-auto px-4 py-12 max-w-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="vessel-card p-8 md:p-10">
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
              <Mic className="w-8 h-8 text-primary" />
            </div>

            <h1 className="text-3xl font-serif font-bold text-foreground mb-2">Create new session</h1>
            <p className="text-muted-foreground mb-8">Set up your studio room to start recording.</p>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="title" className="text-sm font-medium text-secondary-foreground ml-1">
                  Session title
                </label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Interview with Jane Doe"
                  className="h-14 text-lg bg-surface border-border-strong focus-visible:ring-primary rounded-xl px-4"
                  data-testid="input-session-title"
                  autoFocus
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-1.5 ml-1">
                  <Users className="w-4 h-4 text-secondary-foreground" />
                  <label className="text-sm font-medium text-secondary-foreground">
                    Room size
                  </label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="What does room size mean?"
                        data-testid="tooltip-trigger-room-size"
                      >
                        <Info className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      This counts you and everyone you invite. We'll keep
                      the room from getting too crowded by gently turning
                      away anyone past the limit. You can change this any
                      time.
                    </TooltipContent>
                  </Tooltip>
                </div>

                <div
                  className="grid grid-cols-2 sm:grid-cols-4 gap-2"
                  role="radiogroup"
                  aria-label="Room size presets"
                >
                  {ROOM_PRESETS.map((preset) => {
                    const isSelected =
                      preset.value === "custom" ? isCustom : !isCustom && roomSize === preset.value;
                    return (
                      <button
                        key={String(preset.value)}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => handlePresetClick(preset)}
                        className={cn(
                          "flex flex-col items-start text-left rounded-xl border px-3 py-2.5 transition-all",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                          isSelected
                            ? "border-primary bg-primary/10 text-foreground shadow-[0_0_0_1px_rgb(var(--vessel-accent-rgb)/0.4)_inset]"
                            : "border-border-strong bg-surface text-secondary-foreground hover:border-primary/40 hover:text-foreground",
                        )}
                        data-testid={`button-room-size-${preset.value}`}
                      >
                        <span className="text-sm font-semibold leading-tight">{preset.label}</span>
                        <span className="text-[11px] text-muted-foreground mt-0.5">{preset.sub}</span>
                      </button>
                    );
                  })}
                </div>

                {isCustom && (
                  <div className="flex items-center gap-3 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
                    <label htmlFor="customSize" className="text-sm text-secondary-foreground">
                      Cap at
                    </label>
                    <Input
                      id="customSize"
                      type="number"
                      inputMode="numeric"
                      min={ROOM_SIZE_MIN}
                      max={ROOM_SIZE_MAX}
                      value={customInput}
                      onChange={(e) => setCustomInput(e.target.value)}
                      onBlur={() => setCustomInput(String(clampRoomSize(parseInt(customInput, 10))))}
                      className="h-10 w-24 bg-surface border-border-strong focus-visible:ring-primary rounded-lg text-center text-base"
                      data-testid="input-custom-room-size"
                    />
                    <span className="text-sm text-muted-foreground">
                      people <span className="text-muted-foreground/60">(1–25)</span>
                    </span>
                  </div>
                )}

                <p className="text-xs text-muted-foreground ml-1">
                  Up to <span className="text-foreground font-medium">{effectiveSize}</span>{" "}
                  {effectiveSize === 1 ? "person" : "people"} in the room — counts you and your guests.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setLocation("/home")}
                  className="vessel-btn vessel-btn-secondary h-12 px-6"
                  data-testid="button-cancel-session"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim() || createSessionMutation.isPending}
                  className="vessel-btn vessel-btn-primary h-12 px-8 flex-1 gap-2"
                  data-testid="button-create-session"
                >
                  {createSessionMutation.isPending ? "Creating..." : "Enter studio"}
                  {!createSessionMutation.isPending && <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            </form>
          </div>
        </div>
      </TooltipProvider>
    </Layout>
  );
}

function clampRoomSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_ROOM_SIZE;
  return Math.max(ROOM_SIZE_MIN, Math.min(ROOM_SIZE_MAX, Math.floor(n)));
}
