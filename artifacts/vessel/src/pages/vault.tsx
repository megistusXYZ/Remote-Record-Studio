import { useEffect } from "react";
import { useLocation } from "wouter";
import { useIdentity } from "../hooks/use-identity";
import { VaultScreen } from "../components/vault/VaultScreen";

export default function Vault() {
  const [, setLocation] = useLocation();
  const { pubkey, isLoaded } = useIdentity();

  useEffect(() => {
    if (isLoaded && !pubkey) setLocation("/");
  }, [isLoaded, pubkey, setLocation]);

  if (!isLoaded || !pubkey) return null;

  return <VaultScreen pubkey={pubkey} />;
}
