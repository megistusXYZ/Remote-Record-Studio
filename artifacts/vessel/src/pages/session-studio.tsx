import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useIdentity } from "../hooks/use-identity";
import { 
  useGetSession, 
  getGetSessionQueryKey,
  useUpdateSession
} from "@workspace/api-client-react";
import { Mic, MicOff, Video, VideoOff, MonitorUp, Settings, Copy, Check, Users, Radio, Circle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "../components/layout";
import { LobbyScreen } from "../components/lobby/LobbyScreen";
import { cancelSession } from "../lib/session";

export default function SessionStudio() {
  const params = useParams();
  const sessionId = params.id;
  const [, setLocation] = useLocation();
  const { pubkey, isLoaded } = useIdentity();
  const queryClient = useQueryClient();
  
  const [copied, setCopied] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  
  const { data: session, isLoading, error } = useGetSession(
    sessionId || "",
    { 
      query: { 
        enabled: !!sessionId && !!pubkey, 
        queryKey: getGetSessionQueryKey(sessionId || ""),
        refetchInterval: (query) => query.state.data?.status === "waiting" ? 3000 : false,
      } 
    }
  );

  const updateSessionMutation = useUpdateSession();

  useEffect(() => {
    if (error) {
      setLocation("/home");
    }
  }, [error, setLocation]);

  if (!isLoaded || !pubkey) return null;
  if (isLoading || !session) return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background text-foreground dark">
      <div className="w-12 h-12 rounded-full border-4 border-surface border-t-primary animate-spin" />
    </div>
  );

  const isHost = session.hostPubkey === pubkey;

  const handleStartRecording = async () => {
    if (!isHost || !sessionId) return;
    setIsStartingRecording(true);
    try {
      await updateSessionMutation.mutateAsync({
        sessionId,
        data: { status: "live" }
      });
      queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
    } catch (err) {
      console.error(err);
    } finally {
      setIsStartingRecording(false);
    }
  };

  const handleCancelSession = async () => {
    if (!sessionId) return;
    try {
      await cancelSession(sessionId);
      setLocation("/home");
    } catch (err) {
      console.error(err);
    }
  };

  if (session.status === "waiting") {
    return (
      <Layout>
        <LobbyScreen
          state="waitingRoom"
          session={{
            id: session.id,
            title: session.title,
            inviteCode: session.inviteCode,
            hostPubkey: session.hostPubkey,
            hostName: session.hostName,
            participants: session.participants.map(p => ({
              id: p.id,
              displayName: p.displayName,
              pubkey: p.pubkey,
              role: p.role as "host" | "guest",
            })),
          }}
          onStartRecording={isHost ? handleStartRecording : undefined}
          onCancelSession={isHost ? handleCancelSession : undefined}
          isStarting={isStartingRecording}
        />
      </Layout>
    );
  }

  const inviteUrl = `${window.location.origin}/join/${session.inviteCode}`;

  const copyInvite = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleRecording = async () => {
    if (!isHost) return;
    
    const newStatus = session.status === "live" ? "waiting" : "live";
    
    await updateSessionMutation.mutateAsync({
      sessionId: session.id,
      data: { status: newStatus as "live" | "waiting" }
    });
    
    queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(session.id) });
  };

  // Mock participants if there are none (just for UI preview)
  const displayParticipants = session.participants.length > 0 
    ? session.participants 
    : [{ id: "mock-1", displayName: session.hostName, role: "host", pubkey: session.hostPubkey, joinedAt: new Date().toISOString() }];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground dark selection:bg-primary/30 selection:text-primary">
      {/* Studio Header */}
      <header className="h-16 border-b border-border bg-surface/50 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setLocation("/home")}
            className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
          >
            Leave
          </button>
          <div className="h-6 w-px bg-border"></div>
          <h1 className="font-serif font-bold text-lg">{session.title}</h1>
          <div className="flex items-center gap-2 bg-background px-3 py-1 rounded-full border border-border">
            <div className={`status-dot status-dot-${session.status}`} />
            <span className="text-xs font-mono font-medium capitalize text-muted-foreground">
              {session.status}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-background px-3 py-1.5 rounded-full border border-border">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-mono text-muted-foreground">{displayParticipants.length}</span>
          </div>
          
          <button 
            onClick={copyInvite}
            className="vessel-btn vessel-btn-secondary h-9 px-4 gap-2 text-xs"
            data-testid="button-copy-invite"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy Invite"}
          </button>

          {isHost && (
            <button
              onClick={toggleRecording}
              disabled={updateSessionMutation.isPending}
              className={`vessel-btn h-9 px-5 gap-2 text-xs font-bold tracking-wide uppercase ${
                session.status === 'live' 
                  ? 'bg-red hover:bg-red/90 text-white shadow-[0_0_15px_rgba(255,71,87,0.3)]' 
                  : 'vessel-btn-primary'
              }`}
              data-testid="button-toggle-recording"
            >
              {session.status === 'live' ? (
                <>
                  <div className="w-2 h-2 bg-white rounded-full"></div>
                  Stop Recording
                </>
              ) : (
                <>
                  <Circle className="w-3 h-3 fill-current" />
                  Record
                </>
              )}
            </button>
          )}
        </div>
      </header>

      {/* Main Studio Area */}
      <main className="flex-1 flex flex-col md:flex-row p-4 gap-4 min-h-0">
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-fr h-full">
          {displayParticipants.map((p, i) => (
            <div key={p.id} className="vessel-card flex flex-col relative overflow-hidden bg-surface group" data-testid={`participant-${p.id}`}>
              {/* Fallback avatar view since no video */}
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-surface to-background pointer-events-none">
                <div className="w-24 h-24 rounded-full bg-border flex items-center justify-center text-3xl font-serif text-muted-foreground shadow-xl">
                  {p.displayName.charAt(0).toUpperCase()}
                </div>
              </div>
              
              <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-background/90 to-transparent flex items-end justify-between">
                <div className="flex flex-col">
                  <span className="font-medium text-foreground bg-background/80 backdrop-blur px-3 py-1 rounded-full text-sm inline-block w-max mb-2">
                    {p.displayName} {p.id === 'mock-1' ? '(You)' : ''}
                  </span>
                  
                  <div className="audio-meter bg-background/80 backdrop-blur px-3 py-1.5 rounded-full w-max">
                    <div className="audio-bar h-[60%]"></div>
                    <div className="audio-bar h-[100%]"></div>
                    <div className="audio-bar h-[40%]"></div>
                    <div className="audio-bar h-[80%]"></div>
                    <div className="audio-bar h-[50%]"></div>
                  </div>
                </div>
                
                <div className="bg-background/80 backdrop-blur w-8 h-8 rounded-full flex items-center justify-center">
                  <Mic className="w-4 h-4 text-primary" />
                </div>
              </div>
              
              {session.status === 'live' && (
                <div className="absolute top-4 right-4 flex items-center gap-2 bg-background/80 backdrop-blur px-2.5 py-1 rounded-full border border-border">
                  <div className="status-dot status-dot-live w-1.5 h-1.5" />
                  <span className="text-[10px] font-mono text-red uppercase tracking-wider font-bold">Local</span>
                </div>
              )}
            </div>
          ))}
          
          {displayParticipants.length === 1 && (
            <div className="vessel-card border-dashed flex flex-col items-center justify-center text-center p-6 bg-transparent">
              <div className="w-16 h-16 rounded-full bg-surface flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-serif font-medium text-foreground mb-1">Waiting for guests</h3>
              <p className="text-sm text-muted-foreground mb-4">Share the invite link to bring people into your studio.</p>
              <button 
                onClick={copyInvite}
                className="vessel-btn vessel-btn-secondary h-9 px-4 gap-2 text-xs"
              >
                Copy Invite Link
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Control Bar */}
      <footer className="h-20 border-t border-border bg-background flex items-center justify-center gap-3 px-4 shrink-0">
        <button 
          onClick={() => setIsMuted(!isMuted)}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isMuted ? 'bg-red text-white' : 'bg-surface text-foreground hover:bg-surface/80 border border-border'}`}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>
        
        <button 
          onClick={() => setIsVideoOff(!isVideoOff)}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isVideoOff ? 'bg-red text-white' : 'bg-surface text-foreground hover:bg-surface/80 border border-border'}`}
          title={isVideoOff ? "Turn on camera" : "Turn off camera"}
        >
          {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
        </button>
        
        <div className="w-px h-8 bg-border mx-2"></div>
        
        <button className="w-12 h-12 rounded-full bg-surface text-foreground hover:bg-surface/80 border border-border flex items-center justify-center transition-all">
          <MonitorUp className="w-5 h-5" />
        </button>
        
        <button className="w-12 h-12 rounded-full bg-surface text-foreground hover:bg-surface/80 border border-border flex items-center justify-center transition-all">
          <Settings className="w-5 h-5" />
        </button>
      </footer>
    </div>
  );
}
