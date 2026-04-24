import { useEffect } from "react";
import { useLocation } from "wouter";
import { useIdentity } from "../hooks/use-identity";
import { Layout } from "../components/layout";
import { useListRecordings, getListRecordingsQueryKey } from "@workspace/api-client-react";
import { Play, Download, Archive } from "lucide-react";
import { format } from "date-fns";

export default function Vault() {
  const [, setLocation] = useLocation();
  const { pubkey, isLoaded } = useIdentity();
  
  const { data: recordings, isLoading } = useListRecordings(
    { pubkey: pubkey! },
    { query: { enabled: !!pubkey, queryKey: getListRecordingsQueryKey({ pubkey: pubkey! }) } }
  );

  useEffect(() => {
    if (isLoaded && !pubkey) setLocation("/");
  }, [isLoaded, pubkey, setLocation]);

  if (!isLoaded) return null;
  if (!pubkey) return null;

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const isEmpty = !isLoading && (!recordings || recordings.length === 0);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 animate-in fade-in duration-500">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-bold text-foreground">Vault</h1>
          <p className="text-muted-foreground mt-1">All your high-quality local recordings.</p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="vessel-card p-5 h-[160px] animate-pulse" />
            ))}
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="w-20 h-20 rounded-full bg-surface flex items-center justify-center mb-6">
              <Archive className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-serif font-bold text-foreground mb-2">The vault is empty</h2>
            <p className="text-muted-foreground max-w-md mb-8">
              Your recordings will appear here after your first session. We save local, uncompressed audio from every participant.
            </p>
            <button 
              onClick={() => setLocation("/session/new")}
              className="vessel-btn vessel-btn-primary h-11 px-6"
              data-testid="button-vault-new-session"
            >
              Start a new session
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recordings.map(recording => (
              <div key={recording.id} className="vessel-card p-5 flex flex-col group" data-testid={`card-vault-recording-${recording.id}`}>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <button className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all shrink-0">
                      <Play className="w-5 h-5 ml-1" />
                    </button>
                    <div className="overflow-hidden">
                      <h4 className="font-medium text-foreground truncate" title={recording.participantName}>{recording.participantName}</h4>
                      <p className="text-sm text-muted-foreground truncate" title={recording.sessionTitle || "Unknown Session"}>{recording.sessionTitle || "Unknown Session"}</p>
                    </div>
                  </div>
                </div>
                
                <div className="mt-auto pt-4 border-t border-border flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-xs font-mono text-muted-foreground">{formatDuration(recording.durationSeconds)}</span>
                    <span className="text-xs text-muted-foreground mt-0.5">{format(new Date(recording.createdAt), "MMM d, yyyy")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground mr-1">{formatSize(recording.sizeBytes)}</span>
                    <button className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-full hover:bg-surface border border-transparent hover:border-border transition-all">
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
