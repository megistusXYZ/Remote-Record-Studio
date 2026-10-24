// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildSessionInvite } from "./session-invite";

const invite = () =>
  buildSessionInvite({
    uid: "abc123@vessel",
    title: "Episode 12, The future of audio",
    hostName: "Maya",
    start: new Date("2026-11-03T17:00:00Z"),
    durationMinutes: 60,
    joinUrl: "https://vessel.example.com/join/gVyF40Ap",
    now: new Date("2026-10-24T10:00:00Z"),
  });

/** RFC 5545 unfolding: a CRLF followed by one space joins two lines. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("calendar invite", () => {
  it("writes an event with the session link and a short guest checklist", () => {
    expect(unfold(invite())).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Vessel//Session invite//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        "UID:abc123@vessel",
        "DTSTAMP:20261024T100000Z",
        "DTSTART:20261103T170000Z",
        "DTEND:20261103T180000Z",
        "SUMMARY:Episode 12\\, The future of audio (recording with Maya)",
        "LOCATION:https://vessel.example.com/join/gVyF40Ap",
        "URL:https://vessel.example.com/join/gVyF40Ap",
        "DESCRIPTION:Join here: https://vessel.example.com/join/gVyF40Ap\\n\\nBefore we start:\\n- Use Chrome or Edge on a laptop if you can\\n- Wear headphones\\, any kind\\n- Find a quiet room and close other apps\\n- Plug in your laptop\\n\\nNo account or download needed. Your track records on your own device and is sent to Maya when we finish.",
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "ACTION:DISPLAY",
        "DESCRIPTION:Recording with Maya in 15 minutes",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  });

  it("keeps every line within the 75-byte limit calendar apps expect", () => {
    const lines = invite().split("\r\n");
    for (const line of lines)
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(lines.some((l) => l.startsWith(" "))).toBe(true);
  });
});
