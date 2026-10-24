// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createNewIdentity,
  loadSavedIdentity,
  clearStoredIdentity,
  __resetDeviceSecretCache,
} from "./identity";

/**
 * The stored identity must survive everything a browser does to itself.
 *
 * The old key-at-rest scheme mixed the screen size, user agent, time zone and
 * language into the wrapping passphrase, so a window resize signed people
 * out of their studio. These tests pin the new behaviour: the key opens after
 * the "device" changes, and a blob written under the old scheme still opens
 * once and is re-wrapped.
 */

const STORAGE_KEY = "vessel_identity_v3";

function setScreen(width: number, height: number) {
  Object.defineProperty(window.screen, "width", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(window.screen, "height", {
    value: height,
    configurable: true,
  });
}

async function legacyEncrypt(
  data: Uint8Array,
  seed: string,
  fingerprint: string,
) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(seed + "::" + fingerprint),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data),
  );
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  return { iv: b64(iv), salt: b64(salt), ciphertext: b64(ct) };
}

function currentLegacyFingerprint(): string {
  return [
    navigator.userAgent,
    `${screen.width}x${screen.height}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
  ].join("|");
}

beforeEach(() => {
  clearStoredIdentity();
  localStorage.removeItem("vessel_device_secret");
  __resetDeviceSecretCache();
  setScreen(1512, 982);
});

afterEach(() => {
  clearStoredIdentity();
});

describe("identity key at rest", () => {
  it("writes new identities under the device-secret scheme", async () => {
    await createNewIdentity("Ben");
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.encrypted.kdf).toBe("device-v1");
  });

  it("still opens after the screen size, language and user agent change", async () => {
    const created = await createNewIdentity("Ben");
    setScreen(390, 844);
    Object.defineProperty(window.navigator, "language", {
      value: "fr-FR",
      configurable: true,
    });
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Some Other Browser/2.0",
      configurable: true,
    });
    __resetDeviceSecretCache(); // a fresh page load re-reads the secret from storage
    const restored = await loadSavedIdentity();
    expect(restored?._pubkey).toBe(created._pubkey);
  });

  it("opens a blob written under the old fingerprint scheme and re-wraps it", async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const encrypted = await legacyEncrypt(
      secret,
      "Ben",
      currentLegacyFingerprint(),
    );
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 3,
        signerType: "local",
        displayName: "Ben",
        encrypted,
      }),
    );
    const restored = await loadSavedIdentity();
    expect(restored).not.toBeNull();
    const rewrapped = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(rewrapped.encrypted.kdf).toBe("device-v1");
    expect(rewrapped.encrypted.ciphertext).not.toBe(encrypted.ciphertext);
    // From now on the screen size no longer matters.
    setScreen(800, 600);
    __resetDeviceSecretCache();
    const again = await loadSavedIdentity();
    expect(again?._pubkey).toBe(restored?._pubkey);
  });

  it("opens an old blob after the phone was rotated", async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    setScreen(390, 844); // portrait when the key was stored
    const encrypted = await legacyEncrypt(
      secret,
      "Ben",
      currentLegacyFingerprint(),
    );
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 3,
        signerType: "local",
        displayName: "Ben",
        encrypted,
      }),
    );
    setScreen(844, 390); // landscape now
    const restored = await loadSavedIdentity();
    expect(restored).not.toBeNull();
  });
});
