import { useEffect, useState, useCallback } from "react";
import { useRoute } from "wouter";
import {
  resolveShareLink,
  type RecipientManifest,
  type ShareResolveErrorCode,
  ShareResolveError,
} from "../lib/share-resolver";
import { RecipientPage } from "../components/share/RecipientPage";

/**
 * Public viewer route mounted at `/s/:pointer`. No identity / login required.
 *
 * The decryption key lives only in the URL fragment (`window.location.hash`)
 * and is therefore never sent to a server.
 */
export default function ShareView() {
  const [, params] = useRoute<{ pointer: string }>("/s/:pointer");
  const pointer = params?.pointer || "";

  const [loading, setLoading] = useState(true);
  const [manifest, setManifest] = useState<RecipientManifest | null>(null);
  const [error, setError] = useState<{ code: ShareResolveErrorCode; message: string } | null>(null);

  const load = useCallback(async () => {
    if (!pointer) {
      setError({ code: "bad_pointer", message: "Missing share pointer" });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setManifest(null);
    try {
      const result = await resolveShareLink({
        pointer,
        fragment: window.location.hash || "",
      });
      setManifest(result);
    } catch (err) {
      if (err instanceof ShareResolveError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: "network", message: "Something went wrong opening this share." });
      }
    } finally {
      setLoading(false);
    }
  }, [pointer]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <RecipientPage
      loading={loading}
      error={error}
      manifest={manifest}
      onRetry={load}
    />
  );
}
