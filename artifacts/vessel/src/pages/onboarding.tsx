import { useEffect } from "react";
import { useLocation } from "wouter";
import { useIdentity } from "../hooks/use-identity";
import { SignUpScreen } from "../components/onboarding/SignUpScreen";

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { isLoaded, displayName } = useIdentity();

  useEffect(() => {
    if (isLoaded && displayName) {
      setLocation("/home");
    }
  }, [isLoaded, displayName, setLocation]);

  if (!isLoaded || displayName) {
    return null;
  }

  return <SignUpScreen onComplete={() => setLocation("/home")} />;
}
