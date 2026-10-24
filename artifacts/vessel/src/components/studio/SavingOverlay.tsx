import { motion, AnimatePresence } from "framer-motion";
import { VesselButton } from "../vessel-ui/VesselButton";
import { Check } from "lucide-react";
import { AvatarMark } from "../AvatarMark";

export type SavingOverlayProps = {
  open: boolean;
  participants: Array<{ id: string; displayName: string; pubkey?: string }>;
  progressByParticipant: Record<string, { uploaded: number; total: number; done: boolean }>;
  onComplete: () => void;
};

export function SavingOverlay({
  open,
  participants,
  progressByParticipant,
  onComplete,
}: SavingOverlayProps) {
  const allDone = participants.every((p) => progressByParticipant[p.id]?.done);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-vessel-bg-base/95 backdrop-blur-md z-50 flex items-center justify-center p-6"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ delay: 0.1, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-md w-full p-8 rounded-2xl bg-vessel-bg-surface border border-vessel-border shadow-2xl"
          >
            <h2 className="font-display text-2xl font-bold mb-2 text-vessel-text-primary">
              Saving your session…
            </h2>
            <p className="text-sm text-vessel-text-secondary mb-6">
              Don't close this tab. Your high-quality local recordings are being saved.
            </p>

            <div className="space-y-4">
              {participants.map((p) => {
                const prog = progressByParticipant[p.id] || { uploaded: 0, total: 100, done: false };
                const pct = prog.total > 0 ? (prog.uploaded / prog.total) * 100 : 0;

                return (
                  <div key={p.id} className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <AvatarMark
                        pubkey={p.pubkey ?? null}
                        displayName={p.displayName}
                        className="w-8 h-8 border border-white/10"
                        initialsClassName="text-xs"
                      />
                      <div className="text-sm">
                        <span className="font-medium text-vessel-text-primary mr-2">
                          {p.displayName}
                        </span>
                        <span className="text-vessel-text-secondary text-xs">
                          {prog.done
                            ? `${prog.total}/${prog.total} chunks saved`
                            : `uploading... ${prog.uploaded}/${prog.total}`}
                        </span>
                      </div>
                    </div>

                    {prog.done ? (
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-vessel-green/20">
                        <Check className="w-3 h-3 text-vessel-green" />
                      </div>
                    ) : (
                      <div className="w-32 h-1.5 rounded-full bg-vessel-bg-base overflow-hidden border border-vessel-border shrink-0">
                        <motion.div
                          className="h-full bg-vessel-accent"
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ ease: "easeOut" }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <VesselButton
              variant="primary"
              size="lg"
              className="w-full mt-8"
              onClick={onComplete}
              disabled={!allDone}
            >
              {allDone ? "View recording" : "Saving..."}
            </VesselButton>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
