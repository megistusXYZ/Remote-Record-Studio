import { useLocation, useParams } from "wouter";
import { GuestJoinScreen } from "../components/onboarding/GuestJoinScreen";

export default function Join() {
  const params = useParams();
  const inviteCode = params.inviteCode;
  const [, setLocation] = useLocation();

  if (!inviteCode) return null;

  return (
    <GuestJoinScreen
      inviteCode={inviteCode}
      onJoined={(sessionId) => setLocation(`/session/${sessionId}`)}
    />
  );
}
