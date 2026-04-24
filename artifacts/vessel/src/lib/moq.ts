import { useEffect, useState } from "react";

export type ConnectionQuality = "good" | "fair" | "poor" | "unknown";

export function isWebTransportAvailable(): boolean {
  return typeof window !== "undefined" && "WebTransport" in window;
}

export function getConnectionQualityLabel(quality: ConnectionQuality): string {
  switch (quality) {
    case "good":
      return "Connection quality: Good";
    case "fair":
      return "Connection quality: Fair";
    case "poor":
      return "Connection quality: Poor";
    default:
      return "Connection quality: Checking...";
  }
}

export function useConnectionQuality(): ConnectionQuality {
  const [quality, setQuality] = useState<ConnectionQuality>("unknown");

  useEffect(() => {
    if (!isWebTransportAvailable()) {
      setQuality("good");
      return;
    }

    const update = () => {
      const conn = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection;
      if (!conn) {
        setQuality("good");
        return;
      }
      const eff = conn.effectiveType ?? "";
      if (eff === "4g") setQuality("good");
      else if (eff === "3g") setQuality("fair");
      else if (eff === "2g" || eff === "slow-2g") setQuality("poor");
      else setQuality("good");
    };

    update();
    const conn = (navigator as Navigator & { connection?: EventTarget }).connection;
    if (!conn || typeof conn.addEventListener !== "function") return;
    conn.addEventListener("change", update);
    return () => conn.removeEventListener("change", update);
  }, []);

  return quality;
}

export type MoQTransport = {
  send: (data: ArrayBuffer | Uint8Array) => Promise<void>;
  close: () => void;
  isConnected: boolean;
};

export async function connectMoQ(_url: string): Promise<MoQTransport | null> {
  if (!isWebTransportAvailable()) return null;
  return {
    send: async () => {},
    close: () => {},
    isConnected: false,
  };
}
