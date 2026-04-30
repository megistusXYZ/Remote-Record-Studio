import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Settings, ChevronDown, Chrome, KeyRound, ShieldCheck, Loader2, CheckCircle2, AlertCircle, RotateCcw, Key, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { useIdentity } from "../../hooks/use-identity";
import { useToast } from "../../hooks/use-toast";
import { clearAllLocalRecordings } from "../../lib/recordings-storage";
import {
  deriveAvatarColorFromPubkey,
  describeSignerType,
} from "../../lib/identity";
import { setStoredAvatarColor } from "../../hooks/use-avatar-color";
import {
  DEFAULT_AVATAR_ICON_COLOR,
  setStoredAvatarIconColor,
} from "../../hooks/use-avatar-icon-color";
import {
  setStoredAvatarIcon,
  useStoredAvatarIcon,
} from "../../hooks/use-avatar-icon";
import {
  useStoredJoinWithMic,
  useStoredJoinWithCamera,
  setStoredJoinWithMic,
  setStoredJoinWithCamera,
} from "../../hooks/use-join-prefs";
import {
  AVATAR_MARKS,
  type AvatarMarkId,
} from "../icons/avatar-marks";
import { AvatarMark } from "../AvatarMark";
import { BackupKeyModal } from "./BackupKeyModal";
import { StorageServerList } from "./StorageServerList";
import { EndpointList } from "./EndpointList";
import { MoqClient } from "../../lib/moq";
import { notifyRelayUrlChanged } from "../../hooks/use-live-transport";
import observationCabinSketch from "@/assets/illustrations/observation-cabin.png";
import { VaultSidebar } from "./VaultSidebar";
import { VesselButton } from "../vessel-ui/VesselButton";
import { VesselCard } from "../vessel-ui/VesselCard";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const DEFAULT_RELAY_URL =
  (import.meta.env.VITE_MOQ_RELAY_URL as string | undefined) ||
  "https://relay.quic.video";

export type SettingsScreenProps = {
  pubkey: string;
};

const SWATCH_COLORS = ["#00d4aa", "#ff4757", "#ffa502", "#5352ed", "#ff6b9d", "#7bed9f", "#70a1ff", "#ffaa7b"];

// Foreground color choices for the avatar mark / initials. Kept
// intentionally tight: White is the historical default and reads on
// every saturated background; Cream gives a warm, sketch-paper feel
// that pairs with the hand-drawn sketch backdrops; Ink lets light
// background colors carry the avatar; Accent puts the brand color
// on top of a neutral circle.
const ICON_COLOR_SWATCHES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "#ffffff", label: "White" },
  { value: "#f5f1e8", label: "Cream" },
  { value: "#0a0a0a", label: "Ink" },
  { value: "#00d4aa", label: "Accent" },
];

type ReachabilityState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok"; latencyMs: number }
  | { kind: "error"; reason: string };

export function SettingsScreen({ pubkey }: SettingsScreenProps) {
  const [, setLocation] = useLocation();
  const { identity, displayName, setDisplayName, signOut, signerType } = useIdentity();
  const { toast } = useToast();

  const [nameInput, setNameInput] = useState(displayName || "");
  const [isSavingName, setIsSavingName] = useState(false);

  const [selectedColor, setSelectedColor] = useState(() => localStorage.getItem("vessel_avatar_color") || deriveAvatarColorFromPubkey(pubkey));
  const [selectedIconColor, setSelectedIconColor] = useState<string>(
    () => localStorage.getItem("vessel_avatar_icon_color") || DEFAULT_AVATAR_ICON_COLOR,
  );
  const selectedIcon = useStoredAvatarIcon();
  const [inviteMessage, setInviteMessage] = useState(() => localStorage.getItem("vessel_invite_message") || "");

  const [relayUrl, setRelayUrl] = useState(() => localStorage.getItem("vessel_relay_url") || DEFAULT_RELAY_URL);
  const [relayReachability, setRelayReachability] = useState<ReachabilityState>({ kind: "idle" });

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [backupModalOpen, setBackupModalOpen] = useState(false);

  const isLocalSigner = signerType === "local";
  const signerLabel = signerType ? describeSignerType(signerType) : "—";
  const SignerIcon = signerType === "extension" ? Chrome : signerType === "remote" ? KeyRound : ShieldCheck;

  useEffect(() => {
    setStoredAvatarColor(selectedColor);
  }, [selectedColor]);

  useEffect(() => {
    setStoredAvatarIconColor(selectedIconColor);
  }, [selectedIconColor]);

  const handleSaveName = async () => {
    if (!nameInput.trim() || nameInput === displayName) return;
    setIsSavingName(true);
    await setDisplayName(nameInput.trim());
    setIsSavingName(false);
    toast({ title: "Saved", description: "Display name updated." });
  };

  const handleSaveInviteMessage = () => {
    localStorage.setItem("vessel_invite_message", inviteMessage);
    toast({ title: "Saved", description: "Default invite message updated." });
  };

  // Mirror the storage-URL pattern: debounced live probe with abort, plus
  // an explicit Save that only writes once the URL is at least syntactically
  // valid. Probe uses a real WebTransport open (not just a DNS check) via
  // MoqClient.probe.
  const relayProbeAbortRef = useRef<AbortController | null>(null);
  const runRelayReachabilityCheck = useCallback((url: string) => {
    if (!url || !url.startsWith("https://")) {
      setRelayReachability({ kind: "error", reason: "Enter an https:// URL." });
      return;
    }
    setRelayReachability({ kind: "checking" });
    relayProbeAbortRef.current?.abort();
    const ctl = new AbortController();
    relayProbeAbortRef.current = ctl;
    void (async () => {
      const result = await MoqClient.probe(url, ctl.signal, 4000);
      if (ctl.signal.aborted) return;
      if (result.ok) {
        setRelayReachability({ kind: "ok", latencyMs: result.latencyMs });
      } else {
        setRelayReachability({ kind: "error", reason: result.reason });
      }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => runRelayReachabilityCheck(relayUrl), 400);
    return () => clearTimeout(t);
  }, [relayUrl, runRelayReachabilityCheck]);

  useEffect(() => {
    return () => {
      relayProbeAbortRef.current?.abort();
    };
  }, []);

  const handleSaveRelayUrl = () => {
    if (!relayUrl || !relayUrl.startsWith("https://")) {
      toast({ title: "Can't save", description: "Enter an https:// URL.", variant: "destructive" });
      return;
    }
    localStorage.setItem("vessel_relay_url", relayUrl);
    notifyRelayUrlChanged();
    toast({ title: "Saved", description: "Live preview server updated." });
  };

  const handleRestoreDefaultRelay = () => {
    setRelayUrl(DEFAULT_RELAY_URL);
  };

  const isRelayAtDefault = relayUrl === DEFAULT_RELAY_URL;

  const handleClearData = async () => {
    if (window.confirm("Permanently delete all recordings stored on this device?")) {
      await clearAllLocalRecordings();
      toast({ title: "Cleared", description: "Local data has been removed." });
    }
  };

  const handleDeleteAccount = async () => {
    if (window.confirm("Sign out and remove your identity from this device?")) {
      await signOut();
      setLocation("/");
    }
  };

  const handleSwitchSignIn = async () => {
    if (window.confirm("Sign out so you can sign in a different way? Your local recordings stay safe.")) {
      await signOut();
      setLocation("/");
    }
  };

  return (
    <div className="flex h-[100dvh] bg-vessel-bg-base text-vessel-text-primary">
      <VaultSidebar active="settings" />
      <main className="relative flex-1 min-w-0 overflow-y-auto pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-0">
        {/* Same observation-cabin backdrop used on My Vault and
            Shared with me — keeps the sense of place consistent
            across the whole signed-in shell. */}
        <div
          className="pointer-events-none fixed inset-0 z-0 bg-center bg-no-repeat bg-cover opacity-[0.06]"
          style={{
            backgroundImage: `url(${observationCabinSketch})`,
            filter: "invert(1) grayscale(1)",
            maskImage:
              "radial-gradient(ellipse at center, black 35%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, black 35%, transparent 80%)",
          }}
          aria-hidden="true"
        />

        <header className="relative z-10 sticky top-0 bg-vessel-bg-base/80 backdrop-blur-xl border-b border-vessel-border px-4 sm:px-8 py-4 sm:py-0 sm:h-[72px] flex items-center">
          <h1 className="font-display text-3xl font-bold text-vessel-text-primary">Settings</h1>
        </header>

        <div className="relative z-10 px-8 py-6 max-w-2xl space-y-6">
          <VesselCard>
            <div className="p-6 space-y-6">
              <h2 className="font-display text-lg font-bold text-vessel-text-primary">General</h2>
              
              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-vessel-text-muted">Display name</label>
                <div className="flex gap-2">
                  <Input 
                    value={nameInput} 
                    onChange={e => setNameInput(e.target.value)} 
                    className="bg-vessel-bg-base border-vessel-border focus-visible:ring-vessel-accent text-vessel-text-primary"
                    data-testid="input-display-name"
                  />
                  <VesselButton 
                    variant="primary" 
                    size="sm" 
                    onClick={handleSaveName} 
                    disabled={nameInput === displayName || !nameInput.trim()}
                    data-testid="button-save-name"
                  >
                    {isSavingName ? "Saving..." : "Save"}
                  </VesselButton>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-xs uppercase tracking-wider text-vessel-text-muted">Avatar color</label>
                <div className="flex items-center gap-3 flex-wrap">
                  <AvatarMark
                    pubkey={pubkey}
                    displayName={displayName || ""}
                    className="w-12 h-12 shadow-lg"
                    initialsClassName="text-base"
                    colorOverride={selectedColor}
                    iconColorOverride={selectedIconColor}
                    data-testid="avatar-preview"
                  />
                  <div className="flex flex-col gap-2">
                    <div
                      className="flex items-center gap-2 bg-vessel-bg-base p-2 rounded-xl border border-vessel-border"
                      role="radiogroup"
                      aria-label="Avatar background color"
                    >
                      {SWATCH_COLORS.map((color, idx) => (
                        <button
                          key={color}
                          type="button"
                          role="radio"
                          aria-checked={selectedColor === color}
                          aria-label={`Background color ${idx + 1}`}
                          className={`w-7 h-7 rounded-full cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent ${selectedColor === color ? 'ring-2 ring-vessel-text-primary ring-offset-2 ring-offset-vessel-bg-surface scale-110' : 'ring-2 ring-transparent hover:scale-110'}`}
                          style={{ backgroundColor: color }}
                          onClick={() => setSelectedColor(color)}
                          data-testid={`swatch-color-${idx}`}
                        />
                      ))}
                    </div>
                    {/* Icon color — same swatch language, smaller pill,
                        only the four foreground tones that read well on
                        any of the background swatches above. */}
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] uppercase tracking-wider text-vessel-text-muted shrink-0">
                        Icon
                      </span>
                      <div
                        className="flex items-center gap-1.5 bg-vessel-bg-base p-1.5 rounded-xl border border-vessel-border"
                        role="radiogroup"
                        aria-label="Avatar icon color"
                      >
                        {ICON_COLOR_SWATCHES.map(({ value, label }, idx) => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={selectedIconColor === value}
                            aria-label={label}
                            title={label}
                            className={`w-5 h-5 rounded-full cursor-pointer transition-all border border-vessel-border-strong/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent ${selectedIconColor === value ? 'ring-2 ring-vessel-text-primary ring-offset-2 ring-offset-vessel-bg-surface scale-110' : 'ring-2 ring-transparent hover:scale-110'}`}
                            style={{ backgroundColor: value }}
                            onClick={() => setSelectedIconColor(value)}
                            data-testid={`swatch-icon-color-${idx}`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-4">
                  <label className="text-xs uppercase tracking-wider text-vessel-text-muted">
                    Avatar icon
                  </label>
                  {selectedIcon && (
                    <button
                      type="button"
                      onClick={() => setStoredAvatarIcon(null)}
                      className="text-xs text-vessel-text-secondary hover:text-vessel-text-primary transition-colors"
                      data-testid="button-clear-avatar-icon"
                    >
                      Use my initials instead
                    </button>
                  )}
                </div>
                <p className="text-xs text-vessel-text-muted">
                  A little hand-drawn mark just for you. Only you see it — others see your initials.
                </p>
                {/* Clean monochrome grid — preview lives in the big
                    avatar circle above (Avatar color section). Each
                    tile renders just the mark SVG via currentColor; no
                    chunky colored backdrop per tile. */}
                <div
                  className="grid grid-cols-9 sm:grid-cols-9 gap-1 pt-1"
                  role="radiogroup"
                  aria-label="Avatar icon"
                >
                  {AVATAR_MARKS.map((mark) => {
                    const isSelected = selectedIcon === mark.id;
                    const Icon = mark.Component;
                    return (
                      <button
                        key={mark.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        title={mark.label}
                        onClick={() => {
                          setStoredAvatarIcon(
                            isSelected ? null : (mark.id as AvatarMarkId),
                          );
                        }}
                        className={`
                          group flex items-center justify-center
                          aspect-square rounded-lg
                          transition-colors duration-150
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent
                          ${
                            isSelected
                              ? "bg-vessel-accent/10 text-vessel-accent"
                              : "text-vessel-text-muted hover:text-vessel-text-primary hover:bg-vessel-bg-elevated"
                          }
                        `}
                        data-testid={`icon-tile-${mark.id}`}
                        aria-label={mark.label}
                      >
                        <Icon className="w-5 h-5 sm:w-[1.375rem] sm:h-[1.375rem]" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <JoinDefaultsSection />

              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-vessel-text-muted">Sign-in method</label>
                <div className="flex items-center justify-between gap-3 mt-2 p-3 rounded-lg bg-vessel-bg-base border border-vessel-border">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-vessel-bg-elevated border border-vessel-border flex items-center justify-center shrink-0">
                      <SignerIcon className="w-4 h-4 text-vessel-accent" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-vessel-text-primary truncate" data-testid="text-signer-type">{signerLabel}</div>
                      <div className="text-xs text-vessel-text-muted truncate">
                        {signerType === "local"
                          ? "Encrypted on this device only."
                          : signerType === "extension"
                          ? "Signing happens inside your browser extension."
                          : "Signing happens in your remote signer app."}
                      </div>
                    </div>
                  </div>
                  <VesselButton variant="ghost" size="sm" onClick={handleSwitchSignIn} data-testid="button-switch-signin" className="shrink-0">
                    Switch
                  </VesselButton>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-vessel-text-muted">Default invite message</label>
                <p className="text-xs text-vessel-text-muted">Pre-fills when sharing an invite.</p>
                <textarea 
                  value={inviteMessage}
                  onChange={e => setInviteMessage(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-vessel-bg-base border border-vessel-border text-sm focus:border-vessel-border-strong outline-none resize-none text-vessel-text-primary placeholder:text-vessel-text-muted"
                  rows={3}
                  data-testid="textarea-invite-message"
                  placeholder="Join my studio session!"
                />
                <div className="flex justify-end mt-2">
                  <VesselButton variant="primary" size="sm" onClick={handleSaveInviteMessage}>Save</VesselButton>
                </div>
              </div>
            </div>
          </VesselCard>

          <VesselCard>
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="w-full p-6 flex items-center justify-between hover:bg-vessel-bg-elevated transition-colors" data-testid="trigger-advanced-settings">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-vessel-bg-base border border-vessel-border flex items-center justify-center">
                    <Settings className="w-4 h-4 text-vessel-text-muted" />
                  </div>
                  <div className="text-left">
                    <h2 className="font-display text-lg font-bold text-vessel-text-primary">Advanced settings</h2>
                    <p className="text-xs text-vessel-text-muted">Storage, identity, and danger zone</p>
                  </div>
                </div>
                <ChevronDown className={`w-5 h-5 text-vessel-text-muted transition-transform duration-200 ${advancedOpen ? 'rotate-180' : ''}`} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-6 pb-6 pt-2 border-t border-vessel-border space-y-6">

                  <StorageServerList
                    pubkey={pubkey}
                    identity={identity}
                    onToast={(msg) => toast(msg)}
                  />


                  <div className="space-y-1.5">
                    <label className="text-xs uppercase tracking-wider text-vessel-text-muted">Live preview server</label>
                    <p className="text-xs text-vessel-text-muted">Powers the live video preview during recording. Recording quality is unaffected.</p>
                    <div className="flex gap-2 mt-2">
                      <Input
                        value={relayUrl}
                        onChange={e => setRelayUrl(e.target.value)}
                        placeholder="https://preview.example.com"
                        className="bg-vessel-bg-base border-vessel-border text-vessel-text-primary"
                        data-testid="input-relay-url"
                      />
                      <VesselButton variant="primary" size="sm" onClick={handleSaveRelayUrl} data-testid="button-save-relay-url">Save</VesselButton>
                    </div>
                    <div className="flex items-center justify-between gap-3 min-h-[1.25rem]">
                      <div className="flex items-center gap-1.5 text-xs flex-1 min-w-0" data-testid="relay-reachability">
                        {relayReachability.kind === "idle" && (
                          <span className="text-vessel-text-muted truncate">Enter a URL to test it.</span>
                        )}
                        {relayReachability.kind === "checking" && (
                          <>
                            <Loader2 className="w-3.5 h-3.5 text-vessel-text-muted animate-spin shrink-0" />
                            <span className="text-vessel-text-muted truncate">Testing preview server...</span>
                          </>
                        )}
                        {relayReachability.kind === "ok" && (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-vessel-green shrink-0" />
                            <span className="text-vessel-green truncate">Reachable · {relayReachability.latencyMs} ms</span>
                          </>
                        )}
                        {relayReachability.kind === "error" && (
                          <>
                            <AlertCircle className="w-3.5 h-3.5 text-vessel-red shrink-0" />
                            <span className="text-vessel-red truncate">{relayReachability.reason}</span>
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleRestoreDefaultRelay}
                        disabled={isRelayAtDefault}
                        className="text-xs flex items-center gap-1 text-vessel-text-secondary hover:text-vessel-text-primary disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                        data-testid="button-restore-default-relay"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Restore default
                      </button>
                    </div>
                  </div>

                  <EndpointList
                    pubkey={pubkey}
                    identity={identity}
                    onToast={(msg) => toast(msg)}
                  />

                  {isLocalSigner ? (
                    <div className="space-y-1.5">
                      <label className="text-xs uppercase tracking-wider text-vessel-text-muted">Backup key</label>
                      <p className="text-xs text-vessel-text-muted">
                        This key is your account. Save it somewhere private &mdash; it's the only way to restore your studio on a new device.
                      </p>
                      <div className="mt-2">
                        <VesselButton
                          variant="ghost"
                          size="sm"
                          onClick={() => setBackupModalOpen(true)}
                          data-testid="button-show-backup"
                        >
                          <Key className="w-4 h-4 mr-2" />
                          Reveal backup key
                        </VesselButton>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="text-xs uppercase tracking-wider text-vessel-text-muted">Backup key</label>
                      <p className="text-xs text-vessel-text-muted">
                        Your key lives in your {signerType === "extension" ? "browser extension" : "signer app"}, not in Vessel. Use that app to back it up or move it to a new device.
                      </p>
                    </div>
                  )}

                  <div className="border border-vessel-red/20 rounded-xl p-4 space-y-3 bg-vessel-red/5 mt-8">
                    <h3 className="font-display text-base font-bold text-vessel-red">Danger zone</h3>
                    
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-2 border-b border-vessel-red/10">
                      <div>
                        <div className="text-sm font-medium text-vessel-text-primary">Clear local data</div>
                        <div className="text-xs text-vessel-text-muted mt-0.5">Removes saved recordings stored on this device. Cannot be undone.</div>
                      </div>
                      <VesselButton variant="danger" size="sm" onClick={handleClearData} data-testid="button-clear-local" className="shrink-0">
                        Clear data
                      </VesselButton>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-2">
                      <div>
                        <div className="text-sm font-medium text-vessel-text-primary">Delete account</div>
                        <div className="text-xs text-vessel-text-muted mt-0.5">Removes your studio identity from this device. Your recordings stay safe in your vault.</div>
                      </div>
                      <VesselButton variant="danger" size="sm" onClick={handleDeleteAccount} data-testid="button-delete-account" className="shrink-0">
                        Delete account
                      </VesselButton>
                    </div>
                  </div>

                </div>
              </CollapsibleContent>
            </Collapsible>
          </VesselCard>

          <VesselCard>
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-vessel-bg-base border border-vessel-border flex items-center justify-center shrink-0 mt-0.5">
                  <ShieldCheck className="w-4 h-4 text-vessel-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-lg font-bold text-vessel-text-primary">Privacy</h2>
                  <p className="text-xs text-vessel-text-muted mt-0.5">
                    What our server actually stores about you.
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-xs text-vessel-text-secondary leading-relaxed pl-11">
                <p>
                  Vessel&rsquo;s server keeps a short list of plain things: studio
                  names, public identities, invite codes, timestamps, and pointers
                  to where your files live on your storage server. The audio and
                  video themselves never reach us.
                </p>
                <p>
                  Our request logs are equally short: a request id, the method, and
                  the path. No IP address. No user agent. No body.
                </p>
              </div>

              <div className="pl-11">
                <Link
                  href="/privacy"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-vessel-accent hover:underline"
                  data-testid="link-privacy-disclosure"
                >
                  See the literal field list <span aria-hidden="true">&rarr;</span>
                </Link>
              </div>
            </div>
          </VesselCard>
        </div>
      </main>

      <BackupKeyModal
        open={backupModalOpen}
        onOpenChange={setBackupModalOpen}
        identity={identity}
      />
    </div>
  );
}

/**
 * "How you join sessions" — defaults that mirror the inline lobby
 * toggles on each ParticipantCard. Stored under
 * `vessel_join_with_mic` / `vessel_join_with_camera`.
 *
 * Uses a segmented On/Off control instead of a single switch so both
 * states are *always visible* — fixes the "where's the toggle?"
 * problem when a tiny dark switch in OFF state read as disabled.
 */
function JoinDefaultsSection() {
  const joinWithMic = useStoredJoinWithMic();
  const joinWithCamera = useStoredJoinWithCamera();

  return (
    <div className="space-y-1.5">
      <label className="text-xs uppercase tracking-wider text-vessel-text-muted">
        How you join sessions
      </label>
      <p className="text-xs text-vessel-text-muted">
        Choose what's on the moment you enter a recording. You can
        always change your mind in the lobby or once you're in.
      </p>
      <div className="mt-2 rounded-lg bg-vessel-bg-base border border-vessel-border divide-y divide-vessel-border overflow-hidden">
        <JoinDefaultRow
          title="Microphone"
          onLabel="Unmuted"
          offLabel="Muted"
          onHint="Heard right away."
          offHint="You decide when to unmute."
          checked={joinWithMic}
          onCheckedChange={setStoredJoinWithMic}
          OnIcon={Mic}
          OffIcon={MicOff}
          testId="join-with-mic"
        />
        <JoinDefaultRow
          title="Camera"
          onLabel="On"
          offLabel="Off"
          onHint="Camera starts when you enter."
          offHint="Camera stays off until you turn it on."
          checked={joinWithCamera}
          onCheckedChange={setStoredJoinWithCamera}
          OnIcon={Video}
          OffIcon={VideoOff}
          testId="join-with-camera"
        />
      </div>
    </div>
  );
}

function JoinDefaultRow({
  title,
  onLabel,
  offLabel,
  onHint,
  offHint,
  checked,
  onCheckedChange,
  OnIcon,
  OffIcon,
  testId,
}: {
  title: string;
  onLabel: string;
  offLabel: string;
  onHint: string;
  offHint: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  OnIcon: typeof Mic;
  OffIcon: typeof Mic;
  testId: string;
}) {
  const Icon = checked ? OnIcon : OffIcon;
  const hint = checked ? onHint : offHint;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 border bg-vessel-bg-elevated border-vessel-border">
          <Icon
            className={`w-4 h-4 ${
              checked ? "text-vessel-accent" : "text-vessel-text-muted"
            }`}
          />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-vessel-text-primary">
            {title}
          </div>
          <div className="text-xs text-vessel-text-muted">{hint}</div>
        </div>
      </div>

      {/* Segmented On/Off — both states always visible */}
      <div
        role="radiogroup"
        aria-label={`${title} when joining`}
        className="
          inline-flex shrink-0 self-start sm:self-auto
          rounded-full border border-vessel-border bg-vessel-bg-elevated
          p-0.5
        "
      >
        <SegmentedOption
          selected={checked}
          onClick={() => onCheckedChange(true)}
          label={onLabel}
          testId={`button-${testId}-on`}
          tone="accent"
        />
        <SegmentedOption
          selected={!checked}
          onClick={() => onCheckedChange(false)}
          label={offLabel}
          testId={`button-${testId}-off`}
          tone="muted"
        />
      </div>
    </div>
  );
}

function SegmentedOption({
  selected,
  onClick,
  label,
  testId,
  tone,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  testId: string;
  tone: "accent" | "muted";
}) {
  const selectedClasses =
    tone === "accent"
      ? "bg-vessel-accent text-vessel-bg-base shadow-sm"
      : "bg-vessel-bg-base text-vessel-text-primary border border-vessel-border";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      data-testid={testId}
      className={`
        min-w-[4.5rem] px-3 py-1.5 rounded-full text-xs font-semibold
        transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent
        ${
          selected
            ? selectedClasses
            : "text-vessel-text-muted hover:text-vessel-text-primary"
        }
      `}
    >
      {label}
    </button>
  );
}
