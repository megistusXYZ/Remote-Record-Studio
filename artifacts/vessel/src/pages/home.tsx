import { useState } from "react";
import { useLocation } from "wouter";
import { useIdentity } from "../hooks/use-identity";
import { Layout } from "../components/layout";
import { LobbyScreen } from "../components/lobby/LobbyScreen";
import { SignedOutEmpty } from "../components/onboarding/SignedOutEmpty";
import { RecoveryKeyPrompt } from "../components/account/RecoveryKeyPrompt";
import { RecoveryPanel } from "../components/record/RecoveryPanel";
import { createSession, joinSession, extractInviteCodeFromInput } from "../lib/session";
import { useToast } from "../hooks/use-toast";

export default function Home() {
  const [, setLocation] = useLocation();
  const { identity, pubkey, displayName, isLoaded } = useIdentity();
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const { toast } = useToast();

  if (!isLoaded) return null;
  if (!identity || !pubkey || !displayName) {
    return <SignedOutEmpty context="home" />;
  }

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
      <RecoveryPanel className="mb-6" />
      <RecoveryKeyPrompt className="mb-6" />
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
