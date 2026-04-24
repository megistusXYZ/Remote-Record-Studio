import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Settings, ChevronDown, Copy, Chrome, KeyRound, ShieldCheck, Loader2, CheckCircle2, AlertCircle, RotateCcw } from "lucide-react";
import { useIdentity } from "../../hooks/use-identity";
import { useToast } from "../../hooks/use-toast";
import { clearAllLocalRecordings } from "../../lib/recordings-storage";
import {
  deriveAvatarColorFromPubkey,
  describeSignerType,
  exportIdentityBackup,
  getInitials,
} from "../../lib/identity";
import {
  DEFAULT_STORAGE_URL,
  checkStorageReachability,
  getStorageUrl,
  isValidStorageUrl,
  normalizeStorageUrl,
  publishStorageServerList,
  setStorageUrl as persistStorageUrl,
  type ReachabilityResult,
} from "../../lib/storage-config";
import { VaultSidebar } from "./VaultSidebar";
import { VesselButton } from "../vessel-ui/VesselButton";
import { VesselCard } from "../vessel-ui/VesselCard";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export type SettingsScreenProps = {
  pubkey: string;
};

const SWATCH_COLORS = ["#00d4aa", "#ff4757", "#ffa502", "#5352ed", "#ff6b9d", "#7bed9f", "#70a1ff", "#ffaa7b"];

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
  const [inviteMessage, setInviteMessage] = useState(() => localStorage.getItem("vessel_invite_message") || "");

  const [storageUrl, setStorageUrlInput] = useState(() => getStorageUrl(pubkey));
  const [savedStorageUrl, setSavedStorageUrl] = useState(() => getStorageUrl(pubkey));
  const [reachability, setReachability] = useState<ReachabilityState>({ kind: "idle" });
  const [relayUrl, setRelayUrl] = useState(() => localStorage.getItem("vessel_relay_url") || "wss://relay.vessel.local");

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [backupValue, setBackupValue] = useState<string | null>(null);

  const isLocalSigner = signerType === "local";
  const signerLabel = signerType ? describeSignerType(signerType) : "—";
  const SignerIcon = signerType === "extension" ? Chrome : signerType === "remote" ? KeyRound : ShieldCheck;

  useEffect(() => {
    localStorage.setItem("vessel_avatar_color", selectedColor);
  }, [selectedColor]);

  // Live reachability check, debounced. Aborts on unmount or when the URL
  // changes again so we don't race overlapping probes.
  const reachabilityAbortRef = useRef<AbortController | null>(null);
  const runReachabilityCheck = useCallback((url: string) => {
    if (!isValidStorageUrl(url)) {
      setReachability({ kind: "error", reason: "Enter a valid https:// URL." });
      return;
    }
    setReachability({ kind: "checking" });
    reachabilityAbortRef.current?.abort();
    const ctl = new AbortController();
    reachabilityAbortRef.current = ctl;
    void (async () => {
      const result: ReachabilityResult = await checkStorageReachability(url, ctl.signal);
      if (ctl.signal.aborted) return;
      if (result.state === "ok") {
        setReachability({ kind: "ok", latencyMs: result.latencyMs });
      } else {
        setReachability({ kind: "error", reason: result.reason });
      }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => runReachabilityCheck(storageUrl), 400);
    return () => clearTimeout(t);
  }, [storageUrl, runReachabilityCheck]);

  useEffect(() => {
    return () => {
      reachabilityAbortRef.current?.abort();
    };
  }, []);

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

  const handleSaveStorageUrl = async () => {
    const normalized = normalizeStorageUrl(storageUrl);
    if (!isValidStorageUrl(normalized)) {
      toast({ title: "Can't save", description: "Enter a valid https:// URL.", variant: "destructive" });
      return;
    }
    persistStorageUrl(normalized, pubkey);
    setSavedStorageUrl(normalized);
    setStorageUrlInput(normalized);
    toast({ title: "Saved", description: "Storage location updated." });
    // Best-effort: mirror the choice as a portable server list event so it
    // follows the user across devices when they sign in with the same key.
    if (identity) {
      publishStorageServerList(identity, [normalized])
        .then(({ published }) => {
          if (published) {
            toast({ description: "Synced your storage choice across devices." });
          }
        })
        .catch((err) => {
          console.warn("Server list publish failed:", err);
        });
    }
  };

  const handleRestoreDefaultStorage = () => {
    setStorageUrlInput(DEFAULT_STORAGE_URL);
  };

  const handleSaveRelayUrl = () => {
    localStorage.setItem("vessel_relay_url", relayUrl);
    toast({ title: "Saved", description: "Live preview relay updated." });
  };

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

  const handleShowBackup = () => {
    if (!identity) return;
    try {
      const nsec = exportIdentityBackup(identity);
      setBackupValue(nsec);
      setShowBackup(true);
    } catch (err) {
      const description =
        err instanceof Error ? err.message : "Couldn't reveal your backup key.";
      toast({ title: "Not available", description, variant: "destructive" });
    }
  };

  const handleCopyBackup = () => {
    if (!backupValue) return;
    navigator.clipboard.writeText(backupValue);
    toast({ title: "Copied", description: "Backup key copied to clipboard." });
  };

  const isStorageDirty = normalizeStorageUrl(storageUrl) !== savedStorageUrl;
  const isAtDefault = normalizeStorageUrl(storageUrl) === DEFAULT_STORAGE_URL;

  return (
    <div className="flex h-[100dvh] bg-vessel-bg-base text-vessel-text-primary">
      <VaultSidebar active="settings" />
      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 bg-vessel-bg-base/80 backdrop-blur-xl border-b border-vessel-border z-10 px-8 py-6">
          <h1 className="font-display text-3xl font-bold text-vessel-text-primary">Settings</h1>
        </header>

        <div className="px-8 py-6 max-w-2xl space-y-6">
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
                  <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 shadow-lg" style={{ backgroundColor: selectedColor }}>
                    <span className="text-white text-base font-bold">{getInitials(displayName || "")}</span>
                  </div>
                  <div className="flex items-center gap-2 bg-vessel-bg-base p-2 rounded-xl border border-vessel-border">
                    {SWATCH_COLORS.map((color, idx) => (
                      <button
                        key={color}
                        className={`w-7 h-7 rounded-full cursor-pointer transition-all ${selectedColor === color ? 'ring-2 ring-vessel-text-primary ring-offset-2 ring-offset-vessel-bg-surface scale-110' : 'ring-2 ring-transparent hover:scale-110'}`}
                        style={{ backgroundColor: color }}
                        onClick={() => setSelectedColor(color)}
                        data-testid={`swatch-color-${idx}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

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

                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wider text-vessel-text-muted">Storage location</label>
                    <p className="text-xs text-vessel-text-muted">
                      Where your recordings are saved. The default community server is provided for free
                      and isn't operated by Vessel — point to your own server any time.
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Input
                        value={storageUrl}
                        onChange={e => setStorageUrlInput(e.target.value)}
                        className="bg-vessel-bg-base border-vessel-border text-vessel-text-primary"
                        data-testid="input-storage-url"
                      />
                      <VesselButton
                        variant="primary"
                        size="sm"
                        onClick={handleSaveStorageUrl}
                        disabled={!isStorageDirty || !isValidStorageUrl(storageUrl)}
                        data-testid="button-save-storage-url"
                      >
                        Save
                      </VesselButton>
                    </div>
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <div className="text-xs flex items-center gap-1.5 min-w-0" data-testid="text-storage-reachability">
                        {reachability.kind === "checking" && (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-vessel-text-muted shrink-0" />
                            <span className="text-vessel-text-muted truncate">Checking…</span>
                          </>
                        )}
                        {reachability.kind === "ok" && (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-vessel-green shrink-0" />
                            <span className="text-vessel-green truncate">Reachable · {reachability.latencyMs} ms</span>
                          </>
                        )}
                        {reachability.kind === "error" && (
                          <>
                            <AlertCircle className="w-3.5 h-3.5 text-vessel-red shrink-0" />
                            <span className="text-vessel-red truncate">{reachability.reason}</span>
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleRestoreDefaultStorage}
                        disabled={isAtDefault}
                        className="text-xs flex items-center gap-1 text-vessel-text-secondary hover:text-vessel-text-primary disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                        data-testid="button-restore-default-storage"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Restore default
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs uppercase tracking-wider text-vessel-text-muted">Live preview relay</label>
                    <p className="text-xs text-vessel-text-muted">Powers the live video preview during recording.</p>
                    <div className="flex gap-2 mt-2">
                      <Input 
                        value={relayUrl} 
                        onChange={e => setRelayUrl(e.target.value)} 
                        className="bg-vessel-bg-base border-vessel-border text-vessel-text-primary"
                        data-testid="input-relay-url"
                      />
                      <VesselButton variant="primary" size="sm" onClick={handleSaveRelayUrl}>Save</VesselButton>
                    </div>
                  </div>

                  {isLocalSigner ? (
                    <div className="space-y-1.5">
                      <label className="text-xs uppercase tracking-wider text-vessel-text-muted">Export backup key</label>
                      <p className="text-xs text-vessel-text-muted">This key is your account. Keep it somewhere safe &mdash; it lets you restore your studio on any device.</p>
                      <div className="mt-2">
                        {!showBackup ? (
                          <VesselButton variant="ghost" size="sm" onClick={handleShowBackup} data-testid="button-show-backup">
                            Show backup key
                          </VesselButton>
                        ) : (
                          <div className="flex gap-2 items-center">
                            <code className="flex-1 font-mono-vessel text-xs select-all break-all p-3 rounded-lg bg-vessel-bg-base border border-vessel-border-strong text-vessel-text-secondary">
                              {backupValue}
                            </code>
                            <VesselButton variant="ghost" size="sm" onClick={handleCopyBackup} data-testid="button-copy-backup" className="shrink-0">
                              <Copy className="w-4 h-4 mr-2" /> Copy
                            </VesselButton>
                          </div>
                        )}
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
        </div>
      </main>
    </div>
  );
}
