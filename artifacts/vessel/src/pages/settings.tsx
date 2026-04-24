import { useEffect } from "react";
import { useLocation } from "wouter";
import { useIdentity } from "../hooks/use-identity";
import { SettingsScreen } from "../components/vault/SettingsScreen";

export default function Settings() {
  const [, setLocation] = useLocation();
  const { pubkey, isLoaded } = useIdentity();

  useEffect(() => {
    if (isLoaded && !pubkey) setLocation("/");
  }, [isLoaded, pubkey, setLocation]);

  if (!isLoaded || !pubkey) return null;

  return <SettingsScreen pubkey={pubkey} />;
}
