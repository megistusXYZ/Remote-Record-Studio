import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2, Download, Link as LinkIcon, Cloud, CloudOff, AlertCircle } from "lucide-react";
import { deriveAvatarColorFromPubkey, getInitials } from "../../lib/identity";
import { downloadBlob } from "../../lib/recordings-storage";
import { VesselButton } from "../vessel-ui/VesselButton";
import { useToast } from "../../hooks/use-toast";

export type Track = {
  participantId: string;
  participantName: string;
  participantPubkey: string;
  recordingId: string | null;
  blob: Blob | null;
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string;
  hasVideo: boolean;
  /** Where this track ended up. `remote` = saved to participant's storage,
   *  `local-only` = upload didn't reach the storage server (kept on this
   *  device only), `unknown` = sync state still settling. */
  storageState?: "remote" | "local-only" | "unknown";
};

export type SessionCompleteProps = {
  open: boolean;
  isHost: boolean;
  hostName: string;
  syncStatus: "idle" | "syncing" | "complete" | "partial-failure";
  syncProgress: { synced: number; total: number; percent: number; failed: number };
  tracks: Track[];
  onViewVault: () => void;
  onStartNew: () => void;
  onClose?: () => void;
};

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function StorageStateChip({ state }: { state?: "remote" | "local-only" | "unknown" }) {
  if (!state || state === "unknown") {
    return (
      <div className="text-xs text-vessel-text-muted mt-1.5 flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Saving to your storage…</span>
      </div>
    );
  }
  if (state === "remote") {
    return (
      <div className="text-xs text-vessel-green mt-1.5 flex items-center gap-1.5" data-testid="chip-track-storage-remote">
        <Cloud className="w-3 h-3" />
        <span>Saved to your storage</span>
      </div>
    );
  }
  return (
    <div className="text-xs text-vessel-amber mt-1.5 flex items-center gap-1.5" data-testid="chip-track-storage-local">
      <CloudOff className="w-3 h-3" />
      <span>On this device only — couldn't reach your storage</span>
    </div>
  );
}

export function SessionComplete({
  open,
  isHost,
  hostName,
  syncStatus,
  syncProgress,
  tracks,
  onViewVault,
  onStartNew,
  onClose,
}: SessionCompleteProps) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Confetti effect
  useEffect(() => {
    if ((syncStatus === "complete" || syncStatus === "partial-failure") && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const particles: Array<{ x: number; y: number; r: number; color: string; vx: number; vy: number; life: number; maxLife: number }> = [];
      const colors = ["#00d4aa", "#ffffff", "#00a886"];
      
      for (let i = 0; i < 80; i++) {
        particles.push({
          x: canvas.width / 2,
          y: canvas.height / 2,
          r: Math.random() * 4 + 2,
          color: colors[Math.floor(Math.random() * colors.length)],
          vx: (Math.random() - 0.5) * 20,
          vy: (Math.random() - 0.5) * 20 - 5,
          life: 0,
          maxLife: 60 + Math.random() * 30
        });
      }

      let animationFrame: number;
      const animate = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let allDead = true;
        particles.forEach(p => {
          if (p.life < p.maxLife) {
            allDead = false;
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.5; // gravity
            p.life++;
            ctx.globalAlpha = 1 - p.life / p.maxLife;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
          }
        });
        if (!allDead) {
          animationFrame = requestAnimationFrame(animate);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      };
      animate();

      return () => cancelAnimationFrame(animationFrame);
    }
    return undefined;
  }, [syncStatus]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.origin + '/vault');
    toast({ description: "Copied!" });
  };

  const isSyncing = syncStatus === "syncing" || (syncStatus === "idle" && tracks.length === 0);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-vessel-bg-base/95 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
        >
          <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-[60]" />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className={`w-full p-8 rounded-2xl bg-vessel-bg-surface border border-vessel-border shadow-2xl relative z-50 ${isSyncing ? "max-w-md" : (isHost ? "max-w-2xl" : "max-w-md")}`}
          >
            {isSyncing ? (
              // PHASE 1: Syncing
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 mb-6 flex items-end justify-center gap-1">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 bg-vessel-accent rounded-t-sm"
                      animate={{ scaleY: [0.4, 1, 0.4] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.1 }}
                      style={{ originY: 1, height: "100%" }}
                    />
                  ))}
                </div>
                <h2 className="font-display text-2xl font-bold text-vessel-text-primary mb-2">Saving your session...</h2>
                <p className="text-sm text-vessel-text-secondary mb-8">We're packaging your tracks. This usually takes under a minute.</p>
                
                <div className="w-full space-y-0">
                  {tracks.map((track, idx) => (
                    <motion.div
                      key={track.participantId}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.08 }}
                      className="flex items-center gap-3 py-3 border-b border-vessel-border last:border-0"
                    >
                      <div 
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{ backgroundColor: deriveAvatarColorFromPubkey(track.participantPubkey) }}
                      >
                        <span className="text-white text-xs font-bold">{getInitials(track.participantName)}</span>
                      </div>
                      <span className="flex-1 text-sm font-medium text-vessel-text-primary text-left truncate">{track.participantName}</span>
                      <div className="w-32 h-1 rounded-full bg-vessel-bg-base overflow-hidden shrink-0">
                        <div 
                          className="h-full bg-vessel-accent transition-all duration-500"
                          style={{ width: `${syncProgress.percent}%` }}
                        />
                      </div>
                      <span className="font-mono-vessel text-xs text-vessel-text-secondary w-10 text-right shrink-0">{syncProgress.percent}%</span>
                      <div className="w-4 h-4 flex items-center justify-center shrink-0">
                        {syncProgress.percent < 100 ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-vessel-accent" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-vessel-accent" />
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            ) : (
              // PHASE 2: Complete
              <div className="flex flex-col items-center text-center">
                <div className="w-20 h-20 mb-6 flex items-center justify-center">
                  <motion.svg width="80" height="80" viewBox="0 0 80 80" className="text-vessel-accent">
                    <circle cx="40" cy="40" r="38" fill="currentColor" fillOpacity="0.1" />
                    <motion.path
                      d="M25 40 L35 50 L55 30"
                      fill="transparent"
                      stroke="currentColor"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                    />
                  </motion.svg>
                </div>
                
                {isHost ? (
                  <>
                    <h2 className="font-display text-3xl font-bold mb-2 text-vessel-text-primary">Session complete.</h2>
                    <p className="text-sm text-vessel-text-secondary mb-8">Your recordings are ready. Each track is saved separately for studio-quality editing.</p>
                    
                    <div className="w-full space-y-3 mb-8 text-left">
                      {tracks.map((track) => (
                        <div key={track.participantId} className="p-4 rounded-xl bg-vessel-bg-base border border-vessel-border">
                          <div className="flex items-center gap-3 mb-3">
                            <div 
                              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                              style={{ backgroundColor: deriveAvatarColorFromPubkey(track.participantPubkey) }}
                            >
                              <span className="text-white text-sm font-bold">{getInitials(track.participantName)}</span>
                            </div>
                            <div>
                              <div className="font-medium text-vessel-text-primary">{track.participantName}'s Track</div>
                              <div className="text-xs text-vessel-text-muted font-mono-vessel mt-0.5">
                                {track.hasVideo ? 'Video + Audio' : 'Audio'} &middot; {formatDuration(track.durationSeconds)} &middot; {formatSize(track.sizeBytes)}
                              </div>
                              <StorageStateChip state={track.storageState} />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <VesselButton 
                              variant="primary" 
                              size="sm" 
                              data-testid={`button-download-track-${track.participantId}`}
                              onClick={() => {
                                if (track.blob) downloadBlob(track.blob, `${track.participantName.replace(/[^a-z0-9]/gi,'_')}_track.webm`);
                              }}
                              disabled={!track.blob}
                            >
                              <Download className="w-4 h-4 mr-2" />
                              Download Track
                            </VesselButton>
                            <VesselButton 
                              variant="ghost" 
                              size="sm"
                              data-testid={`button-copy-track-link-${track.participantId}`}
                              onClick={handleCopyLink}
                            >
                              <LinkIcon className="w-4 h-4 mr-2" />
                              Copy File Link
                            </VesselButton>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
                      <VesselButton 
                        variant="primary" 
                        className="w-full sm:w-auto" 
                        onClick={onViewVault}
                        data-testid="button-view-vault"
                      >
                        View in My Vault &rarr;
                      </VesselButton>
                      <VesselButton 
                        variant="ghost" 
                        className="w-full sm:w-auto" 
                        onClick={onStartNew}
                        data-testid="button-start-new"
                      >
                        Start New Session
                      </VesselButton>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="font-display text-2xl font-bold mb-2 text-vessel-text-primary">Thanks for recording with {hostName}!</h2>
                    <p className="text-sm text-vessel-text-secondary mb-6">{hostName} will receive your track. Nothing to do on your end.</p>
                    <p className="text-xs text-vessel-text-muted mb-3">Want to keep your own copy?</p>
                    
                    <div className="flex flex-col gap-3 w-full">
                      {tracks[0]?.blob && (
                        <VesselButton 
                          variant="ghost" 
                          size="sm"
                          onClick={() => {
                            if (tracks[0]?.blob) downloadBlob(tracks[0].blob, `${tracks[0].participantName.replace(/[^a-z0-9]/gi,'_')}_track.webm`);
                          }}
                        >
                          Download Your Track
                        </VesselButton>
                      )}
                      <VesselButton 
                        variant="primary"
                        onClick={onClose}
                        data-testid="button-guest-close"
                      >
                        Close
                      </VesselButton>
                    </div>
                  </>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
