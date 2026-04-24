import { useEffect } from "react";
import { useLocation } from "wouter";
import { useIdentity } from "../hooks/use-identity";
import { Layout } from "../components/layout";
import { 
  useGetVaultSummary, 
  getGetVaultSummaryQueryKey,
  useGetRecentActivity,
  getGetRecentActivityQueryKey
} from "@workspace/api-client-react";
import { Play, Download, Plus, Mic } from "lucide-react";
import { format } from "date-fns";

export default function Home() {
  const [, setLocation] = useLocation();
  const { pubkey, displayName, isLoaded } = useIdentity();
  
  const { data: vaultSummary, isLoading: isLoadingSummary } = useGetVaultSummary(
    { pubkey: pubkey! },
    { query: { enabled: !!pubkey, queryKey: getGetVaultSummaryQueryKey({ pubkey: pubkey! }) } }
  );

  const { data: activity, isLoading: isLoadingActivity } = useGetRecentActivity(
    { pubkey: pubkey!, limit: 5 },
    { query: { enabled: !!pubkey, queryKey: getGetRecentActivityQueryKey({ pubkey: pubkey!, limit: 5 }) } }
  );

  useEffect(() => {
    if (isLoaded && (!pubkey || !displayName)) {
      setLocation("/");
    }
  }, [isLoaded, pubkey, displayName, setLocation]);

  if (!isLoaded) return null;
  if (!pubkey || !displayName) return null;

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  };

  const formatSize = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  };

  const isEmpty = !isLoadingSummary && !isLoadingActivity && (!activity?.recentSessions?.length && !activity?.recentRecordings?.length);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground">Welcome back, {displayName}</h1>
            <p className="text-muted-foreground mt-1">Here is what's happening in your studio.</p>
          </div>
          <button 
            onClick={() => setLocation("/session/new")}
            className="vessel-btn vessel-btn-primary h-11 px-6 gap-2"
            data-testid="button-new-session"
          >
            <Plus className="w-4 h-4" />
            Start a new session
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          <div className="vessel-card p-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Total Recordings</h3>
            <p className="text-3xl font-serif font-bold text-foreground">
              {isLoadingSummary ? "-" : vaultSummary?.totalRecordings || 0}
            </p>
          </div>
          <div className="vessel-card p-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Total Duration</h3>
            <p className="text-3xl font-serif font-bold text-foreground">
              {isLoadingSummary ? "-" : formatDuration(vaultSummary?.totalDurationSeconds || 0)}
            </p>
          </div>
          <div className="vessel-card p-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Storage Used</h3>
            <p className="text-3xl font-serif font-bold text-foreground">
              {isLoadingSummary ? "-" : formatSize(vaultSummary?.totalSizeBytes || 0)}
            </p>
          </div>
        </div>

        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border rounded-xl bg-surface/50">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Mic className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-serif font-bold text-foreground mb-2">Your studio is ready</h2>
            <p className="text-muted-foreground max-w-md mb-6">Create a new session to invite guests and start recording broadcast-quality audio.</p>
            <button 
              onClick={() => setLocation("/session/new")}
              className="vessel-btn vessel-btn-primary h-11 px-6 gap-2"
              data-testid="button-empty-new-session"
            >
              <Plus className="w-4 h-4" />
              Create Session
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Recent Sessions */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-serif font-bold text-foreground">Recent Sessions</h2>
              </div>
              <div className="space-y-3">
                {isLoadingActivity ? (
                  <div className="vessel-card p-5 animate-pulse flex h-[88px]" />
                ) : activity?.recentSessions?.length ? (
                  activity.recentSessions.map(session => (
                    <div 
                      key={session.id} 
                      className="vessel-card p-4 flex items-center justify-between cursor-pointer group"
                      onClick={() => setLocation(`/session/${session.id}`)}
                      data-testid={`card-session-${session.id}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center">
                          <Mic className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                        <div>
                          <h4 className="font-medium text-foreground">{session.title}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <div className={`status-dot status-dot-${session.status}`} />
                            <span className="text-xs text-muted-foreground capitalize">{session.status}</span>
                            <span className="text-xs text-muted-foreground">•</span>
                            <span className="text-xs text-muted-foreground">{format(new Date(session.createdAt), "MMM d, yyyy")}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground py-4">No recent sessions.</p>
                )}
              </div>
            </div>

            {/* Recent Recordings */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-serif font-bold text-foreground">Recent Recordings</h2>
                <button 
                  onClick={() => setLocation("/vault")}
                  className="text-sm font-medium text-primary hover:text-primary/80"
                >
                  View Vault
                </button>
              </div>
              <div className="space-y-3">
                {isLoadingActivity ? (
                  <div className="vessel-card p-5 animate-pulse flex h-[88px]" />
                ) : activity?.recentRecordings?.length ? (
                  activity.recentRecordings.map(recording => (
                    <div key={recording.id} className="vessel-card p-4 flex items-center justify-between group" data-testid={`card-recording-${recording.id}`}>
                      <div className="flex items-center gap-4">
                        <button className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                          <Play className="w-4 h-4 ml-0.5" />
                        </button>
                        <div>
                          <h4 className="font-medium text-foreground">{recording.participantName}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-muted-foreground">{recording.sessionTitle || "Unknown Session"}</span>
                            <span className="text-xs text-muted-foreground">•</span>
                            <span className="text-xs font-mono text-muted-foreground">{formatDuration(recording.durationSeconds)}</span>
                          </div>
                        </div>
                      </div>
                      <button className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-full hover:bg-surface transition-colors">
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground py-4">No recordings yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
