import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useIdentity } from "../hooks/use-identity";
import { Input } from "@/components/ui/input";
import { useJoinSession } from "@workspace/api-client-react";
import { Mic, ArrowRight } from "lucide-react";

export default function Join() {
  const params = useParams();
  const inviteCode = params.inviteCode;
  const [, setLocation] = useLocation();
  const { pubkey, displayName, setDisplayName, isLoaded } = useIdentity();
  
  const [name, setName] = useState(displayName || "");
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const joinSessionMutation = useJoinSession();

  useEffect(() => {
    if (isLoaded && displayName && !name) {
      setName(displayName);
    }
  }, [isLoaded, displayName, name]);

  if (!isLoaded || !inviteCode) return null;

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isJoining) return;
    
    setIsJoining(true);
    setError(null);
    
    try {
      // Ensure identity is saved if it's new or changed
      if (name.trim() !== displayName) {
        await setDisplayName(name.trim());
      }
      
      // Use the newly set pubkey if needed, but since it's async we'll get it from identity
      const currentPubkey = pubkey || JSON.parse(localStorage.getItem("vessel_identity") || "{}").pubkey;
      
      const session = await joinSessionMutation.mutateAsync({
        sessionId: inviteCode, // API expects session ID, we're using invite code as ID for simplicity in mock
        data: {
          guestName: name.trim(),
          guestPubkey: currentPubkey
        }
      });
      
      setLocation(`/session/${session.id}`);
    } catch (err: any) {
      console.error("Failed to join:", err);
      setError("This invite link seems to be invalid or expired.");
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background dark text-foreground px-4">
      <div className="w-full max-w-md animate-in fade-in zoom-in duration-700">
        <div className="vessel-card p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-6">
            <Mic className="w-8 h-8 text-primary" />
          </div>
          
          <h1 className="text-2xl font-serif font-bold mb-2">Join Studio</h1>
          <p className="text-muted-foreground mb-8 text-sm">You've been invited to a broadcast-quality recording session.</p>

          {error && (
            <div className="bg-red/10 border border-red/20 text-red text-sm rounded-lg p-3 mb-6 text-left">
              {error}
            </div>
          )}

          <form onSubmit={handleJoin} className="space-y-6">
            <div className="space-y-2 text-left">
              <label htmlFor="name" className="text-sm font-medium text-secondary-foreground ml-1">
                Your Name
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                className="h-14 text-lg bg-surface border-border-strong focus-visible:ring-primary rounded-xl px-4"
                data-testid="input-join-name"
                autoFocus={!displayName}
              />
            </div>
            
            <button
              type="submit"
              disabled={!name.trim() || isJoining}
              className="vessel-btn vessel-btn-primary w-full h-14 text-lg gap-2"
              data-testid="button-join-session"
            >
              {isJoining ? "Connecting..." : "Join Session"}
              {!isJoining && <ArrowRight className="w-5 h-5" />}
            </button>
          </form>
        </div>
      </div>
      
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_var(--tw-gradient-stops))] from-primary/5 via-background to-background -z-10 pointer-events-none"></div>
    </div>
  );
}
