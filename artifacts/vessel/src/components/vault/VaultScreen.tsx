import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Search, MoreHorizontal, Download, AlertTriangle, Check, Loader2 } from "lucide-react";
import { useListRecordings, getListRecordingsQueryKey } from "@workspace/api-client-react";
import { downloadRecordingById, isLocalBlobUrl } from "../../lib/recordings-storage";
import { useToast } from "../../hooks/use-toast";
import { deriveAvatarColorFromPubkey, getInitials } from "../../lib/identity";
import { VaultSidebar } from "./VaultSidebar";
import { EmptyState } from "./EmptyState";
import { VesselButton } from "../vessel-ui/VesselButton";

export type VaultScreenProps = {
  pubkey: string;
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

export function VaultScreen({ pubkey }: VaultScreenProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(new Set());

  const { data: recordings, isLoading } = useListRecordings(
    { pubkey },
    { query: { enabled: !!pubkey, queryKey: getListRecordingsQueryKey({ pubkey }) } }
  );

  const filteredSessions = useMemo(() => {
    const sessionsMap = new Map<string, { id: string; title: string; createdAt: Date; recordings: any[]; maxDuration: number; totalSize: number }>();
    for (const r of recordings || []) {
      const key = r.sessionId || `__solo_${r.id}`;
      if (!sessionsMap.has(key)) {
        sessionsMap.set(key, { id: key, title: r.sessionTitle || "Untitled session", createdAt: new Date(r.createdAt), recordings: [], maxDuration: 0, totalSize: 0 });
      }
      const s = sessionsMap.get(key)!;
      s.recordings.push(r);
      s.maxDuration = Math.max(s.maxDuration, r.durationSeconds);
      s.totalSize += r.sizeBytes;
      const rDate = new Date(r.createdAt);
      if (rDate < s.createdAt) s.createdAt = rDate;
    }
    const sessionsList = Array.from(sessionsMap.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (!search) return sessionsList;
    return sessionsList.filter(s => s.title.toLowerCase().includes(search.toLowerCase()));
  }, [recordings, search]);

  const toggleExpand = (id: string) => {
    setExpandedSessionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDownloadAll = async (session: any) => {
    for (const r of session.recordings) {
      if (isLocalBlobUrl(r.blobUrl)) {
        await downloadRecordingById(r.id, `${r.participantName}_track.webm`);
      } else {
        toast({ description: "Local copy not available — was this recording made on a different device?" });
      }
    }
  };

  const handleDownloadTrack = async (r: any) => {
    if (isLocalBlobUrl(r.blobUrl)) {
      await downloadRecordingById(r.id, `${r.participantName}_track.webm`);
    } else {
      toast({ description: "Local copy not available — was this recording made on a different device?" });
    }
  };

  return (
    <div className="flex h-[100dvh] bg-vessel-bg-base text-vessel-text-primary">
      <VaultSidebar active="my-vault" myVaultCount={filteredSessions.length} />
      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 bg-vessel-bg-base/80 backdrop-blur-xl border-b border-vessel-border z-10 px-4 sm:px-8 py-4 sm:py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h1 className="font-display text-3xl font-bold text-vessel-text-primary">My Vault</h1>
          <div className="relative w-full sm:w-auto">
            <Search className="w-4 h-4 text-vessel-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search sessions..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full sm:w-64 pl-10 pr-3 py-2 rounded-lg bg-vessel-bg-surface border border-vessel-border text-sm focus:border-vessel-border-strong outline-none text-vessel-text-primary placeholder:text-vessel-text-muted"
            />
          </div>
        </header>

        <div className="px-4 sm:px-8 py-6 space-y-4">
          {isLoading ? (
            <>
              <div className="h-44 rounded-xl bg-vessel-bg-surface/50 animate-pulse" />
              <div className="h-44 rounded-xl bg-vessel-bg-surface/50 animate-pulse" />
              <div className="h-44 rounded-xl bg-vessel-bg-surface/50 animate-pulse" />
            </>
          ) : filteredSessions.length === 0 ? (
            <EmptyState 
              title="Nothing in your vault yet" 
              subtitle="Start a recording session to see your tracks here." 
              ctaLabel="Start a Session &rarr;" 
              onCta={() => setLocation('/home')} 
              ctaTestId="button-vault-empty-cta" 
            />
          ) : (
            filteredSessions.map(session => {
              const isExpanded = expandedSessionIds.has(session.id);
              const uniqueParticipants = Array.from(new Set(session.recordings.map(r => r.participantName))).map(name => session.recordings.find(r => r.participantName === name)!);

              return (
                <div key={session.id} className="p-6 rounded-xl bg-vessel-bg-surface border border-vessel-border hover:border-vessel-border-strong transition-colors" data-testid={`card-session-${session.id}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-vessel-accent shadow-[0_0_8px_rgba(0,212,170,0.4)]" />
                        <h2 className="font-display text-lg font-bold text-vessel-text-primary">{session.title}</h2>
                      </div>
                      <div className="text-xs text-vessel-text-muted font-mono-vessel mt-1">
                        {format(session.createdAt, 'MMM d, yyyy')} &middot; {formatDuration(session.maxDuration)}
                      </div>
                    </div>
                    <div className="text-xs text-vessel-text-muted font-mono-vessel text-right">
                      {session.recordings.length} track(s) &middot; Total: {formatSize(session.totalSize)}
                    </div>
                  </div>

                  <div className="mb-4">
                    <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-vessel-bg-base border border-vessel-border mr-2 mb-2 text-vessel-accent text-xs font-medium hover:bg-vessel-bg-elevated transition-colors">
                      &#9654; Preview
                    </button>
                    {uniqueParticipants.map((p, i) => (
                      <div key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-vessel-bg-base border border-vessel-border mr-2 mb-2">
                        <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: deriveAvatarColorFromPubkey(p.ownerPubkey) }}>
                          <span className="text-white text-[8px] font-bold">{getInitials(p.participantName)[0]}</span>
                        </div>
                        <span className="text-xs text-vessel-text-secondary">{p.participantName}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <VesselButton variant="ghost" size="sm" onClick={() => handleDownloadAll(session)} data-testid={`button-download-all-${session.id}`}>
                      <Download className="w-4 h-4 mr-2" /> Download All
                    </VesselButton>
                    <VesselButton variant="ghost" size="sm" onClick={() => toggleExpand(session.id)} data-testid={`button-toggle-tracks-${session.id}`}>
                      {isExpanded ? "Hide Tracks" : "View Tracks"}
                    </VesselButton>
                    <button className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-vessel-bg-base transition-colors ml-auto text-vessel-text-secondary">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-vessel-border mt-4 pt-4 space-y-2">
                          {session.recordings.map(r => (
                            <div key={r.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-vessel-bg-base transition-colors">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: deriveAvatarColorFromPubkey(r.ownerPubkey) }}>
                                <span className="text-white text-xs font-bold">{getInitials(r.participantName)}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-vessel-text-primary truncate">{r.participantName}</div>
                                <div className="text-xs text-vessel-text-muted font-mono-vessel">
                                  {formatDuration(r.durationSeconds)} &middot; {formatSize(r.sizeBytes)} &middot; {r.mimeType.includes('video') ? 'Video + Audio' : 'Audio'}
                                </div>
                              </div>
                              <div className="w-6 flex items-center justify-center shrink-0">
                                {r.status === "ready" ? <Check className="w-4 h-4 text-vessel-green" /> : r.status === "processing" ? <Loader2 className="w-4 h-4 text-vessel-accent animate-spin" /> : <AlertTriangle className="w-4 h-4 text-vessel-red" />}
                              </div>
                              <button 
                                onClick={() => handleDownloadTrack(r)}
                                className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-vessel-bg-elevated transition-colors shrink-0"
                                data-testid={`button-download-track-${r.id}`}
                              >
                                <Download className="w-4 h-4 text-vessel-text-secondary" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
