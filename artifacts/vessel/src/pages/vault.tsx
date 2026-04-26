import { useIdentity } from "../hooks/use-identity";
import { VaultScreen } from "../components/vault/VaultScreen";
import { SignedOutEmpty } from "../components/onboarding/SignedOutEmpty";

export default function Vault() {
  const { pubkey, isLoaded } = useIdentity();

  if (!isLoaded) return null;
  if (!pubkey) return <SignedOutEmpty context="vault" />;

  return <VaultScreen pubkey={pubkey} />;
}
