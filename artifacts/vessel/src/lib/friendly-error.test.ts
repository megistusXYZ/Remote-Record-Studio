import { describe, it, expect } from "vitest";
import { friendlyError, PlainError } from "./friendly-error";
import { TrackDecryptError } from "./track-crypto";
import { ShareResolveError } from "./share-resolver";

const named = (name: string, message = "raw browser text") =>
  Object.assign(new Error(message), { name });

describe("friendly errors", () => {
  it("explains a blocked camera or microphone in plain words", () => {
    expect(friendlyError(named("NotAllowedError"), "Fallback.")).toBe(
      "Your browser blocked the camera or microphone. Allow it from the address bar, then try again.",
    );
  });

  it("names a missing or busy device", () => {
    expect(friendlyError(named("NotFoundError"), "x")).toBe(
      "No camera or microphone was found. Plug one in, then try again.",
    );
    expect(friendlyError(named("NotReadableError"), "x")).toBe(
      "Another app is using your camera or microphone. Close it, then try again.",
    );
  });

  it("treats a failed request as a connection problem", () => {
    expect(friendlyError(new TypeError("Failed to fetch"), "x")).toBe(
      "Couldn't reach the server. Check your connection, then try again.",
    );
  });

  it("explains API answers by status", () => {
    const api = (status: number) =>
      Object.assign(new Error(`HTTP ${status} Whatever`), {
        name: "ApiError",
        status,
      });
    expect(friendlyError(api(401), "x")).toBe(
      "Your sign-in expired on this device. Reload the page and try again.",
    );
    expect(friendlyError(api(404), "x")).toBe(
      "That session or recording no longer exists.",
    );
    expect(friendlyError(api(410), "x")).toBe("That session has ended.");
    expect(friendlyError(api(429), "x")).toBe(
      "Too many tries in a row. Wait a minute, then try again.",
    );
    expect(friendlyError(api(503), "x")).toBe(
      "The server is having trouble. Try again in a moment.",
    );
  });

  it("keeps messages that were already written for people", () => {
    expect(friendlyError(new TrackDecryptError(), "x")).toBe(
      new TrackDecryptError().message,
    );
    expect(
      friendlyError(
        new ShareResolveError("not_found", "This link has expired."),
        "x",
      ),
    ).toBe("This link has expired.");
    expect(friendlyError(new PlainError("Pick a shorter title."), "x")).toBe(
      "Pick a shorter title.",
    );
  });

  it("never shows developer text it doesn't recognise", () => {
    expect(
      friendlyError(
        new Error(
          "TypeError: cannot read properties of undefined (reading 'x')",
        ),
        "Something went wrong.",
      ),
    ).toBe("Something went wrong.");
    expect(friendlyError("a string", "Something went wrong.")).toBe(
      "Something went wrong.",
    );
    expect(friendlyError(null, "Something went wrong.")).toBe(
      "Something went wrong.",
    );
  });
});
