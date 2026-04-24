import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useIdentity } from "../hooks/use-identity";
import { Layout } from "../components/layout";
import { LobbyScreen } from "../components/lobby/LobbyScreen";
import { createSession, joinSession, extractInviteCodeFromInput } from "../lib/session";
import { useToast } from "../hooks/use-toast";

export default function Home() {
  const [, setLocation] = useLocation();
  const { identity, pubkey, displayName, isLoaded } = useIdentity();
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isLoaded && (!pubkey || !displayName)) {
      setLocation("/");
    }
  }, [isLoaded, pubkey, displayName, setLocation]);

  if (!isLoaded || !identity) return null;

  const handleCreate = async (title: string) => {
    setIsCreating(true);
    try {
      const result = await createSession(identity, { title });
      try {
        await navigator.clipboard.writeText(result.inviteUrl);
        toast({ description: "Session created — invite link copied!" });
      } catch {
        toast({ description: "Session created — share the invite link from the lobby." });
      }
      setLocation(`/session/${result.sessionId}`);
    } catch (err) {
      console.error(err);
      toast({
        title: "Couldn't create session",
        description: "Check your connection and try again.",
        variant: "destructive"
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoin = async (rawInput: string) => {
    setIsJoining(true);
    try {
      const code = extractInviteCodeFromInput(rawInput);
      if (!code) throw new Error("Invalid invite");
      const result = await joinSession(code, identity);
      setLocation(`/session/${result.sessionId}`);
    } catch (err) {
      console.error(err);
      toast({
        title: "Error",
        description: "Couldn't join — that invite link doesn't look right.",
        variant: "destructive"
      });
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <Layout>
      <LobbyScreen
        state="default"
        onCreateSession={handleCreate}
        onJoinByCode={handleJoin}
        isCreating={isCreating}
        isJoining={isJoining}
      />
    </Layout>
  );
}
