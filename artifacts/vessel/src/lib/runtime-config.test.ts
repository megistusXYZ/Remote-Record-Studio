import { describe, it, expect, afterEach, vi } from "vitest";
import {
  deploymentRelays,
  deploymentStorageServer,
  deploymentMoqRelayUrl,
} from "./runtime-config";

type ConfigWindow = Window & { __VESSEL_CONFIG__?: unknown };

afterEach(() => {
  delete (window as ConfigWindow).__VESSEL_CONFIG__;
  vi.unstubAllEnvs();
});

describe("runtime-config", () => {
  it("returns nothing when neither the container nor the build configured anything", () => {
    expect(deploymentRelays()).toEqual([]);
    expect(deploymentStorageServer()).toBeNull();
    expect(deploymentMoqRelayUrl()).toBe("");
  });

  it("reads the values the container wrote, trimming and dropping bad entries", () => {
    (window as ConfigWindow).__VESSEL_CONFIG__ = {
      relays: [
        " wss://sync.example.com ",
        "https://not-a-socket.example",
        "",
        42,
      ],
      storageServer: "https://files.example.com/",
      moqRelayUrl: "https://preview.example.com/",
    };
    expect(deploymentRelays()).toEqual(["wss://sync.example.com"]);
    expect(deploymentStorageServer()).toBe("https://files.example.com");
    expect(deploymentMoqRelayUrl()).toBe("https://preview.example.com");
  });

  it("accepts a comma-separated string for the server list", () => {
    (window as ConfigWindow).__VESSEL_CONFIG__ = {
      relays: "wss://a.example, ws://localhost:7777,,bogus",
    };
    expect(deploymentRelays()).toEqual([
      "wss://a.example",
      "ws://localhost:7777",
    ]);
  });

  it("falls back to the build-time variables when the container set nothing", () => {
    vi.stubEnv("VITE_NOSTR_RELAYS", "wss://built.example,wss://in.example");
    vi.stubEnv("VITE_BLOSSOM_SERVER", "https://built-files.example/");
    vi.stubEnv("VITE_MOQ_RELAY_URL", "https://built-preview.example");
    (window as ConfigWindow).__VESSEL_CONFIG__ = {};
    expect(deploymentRelays()).toEqual([
      "wss://built.example",
      "wss://in.example",
    ]);
    expect(deploymentStorageServer()).toBe("https://built-files.example");
    expect(deploymentMoqRelayUrl()).toBe("https://built-preview.example");
  });

  it("lets the container override the build", () => {
    vi.stubEnv("VITE_NOSTR_RELAYS", "wss://built.example");
    (window as ConfigWindow).__VESSEL_CONFIG__ = {
      relays: ["wss://runtime.example"],
    };
    expect(deploymentRelays()).toEqual(["wss://runtime.example"]);
  });

  it("ignores a storage server that is not https", () => {
    (window as ConfigWindow).__VESSEL_CONFIG__ = {
      storageServer: "http://files.localhost",
    };
    expect(deploymentStorageServer()).toBeNull();
  });

  it("makes the deployment's servers the default sync list", async () => {
    (window as ConfigWindow).__VESSEL_CONFIG__ = {
      relays: ["wss://runtime.example"],
    };
    vi.resetModules();
    const mod = await import("./relay-config");
    expect(mod.DEFAULT_PUBLISH_RELAYS).toEqual(["wss://runtime.example"]);
  });
});
