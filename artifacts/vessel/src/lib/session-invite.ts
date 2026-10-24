/**
 * A calendar invite (.ics) for a scheduled session: the link, a short guest
 * checklist, and a reminder 15 minutes before. Works in Google Calendar,
 * Apple Calendar and Outlook; nothing is sent anywhere, the host shares the
 * file or its text however they like.
 */
export type SessionInviteInput = {
  uid: string;
  title: string;
  hostName: string;
  start: Date;
  durationMinutes: number;
  joinUrl: string;
  now?: Date;
};

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

/** RFC 5545 text escaping. */
const esc = (text: string) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

/** Fold to 75 octets per line; continuation lines start with one space. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let limit = 75;
  for (const ch of line) {
    if (enc.encode(current + ch).length > limit) {
      out.push(current);
      current = " " + ch;
      limit = 75;
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.join("\r\n");
}

export function guestChecklist(hostName: string, joinUrl: string): string {
  return [
    `Join here: ${joinUrl}`,
    "",
    "Before we start:",
    "- Use Chrome or Edge on a laptop if you can",
    "- Wear headphones, any kind",
    "- Find a quiet room and close other apps",
    "- Plug in your laptop",
    "",
    `No account or download needed. Your track records on your own device and is sent to ${hostName} when we finish.`,
  ].join("\n");
}

export function buildSessionInvite(input: SessionInviteInput): string {
  const end = new Date(input.start.getTime() + input.durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vessel//Session invite//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${stamp(input.now ?? new Date())}`,
    `DTSTART:${stamp(input.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(`${input.title} (recording with ${input.hostName})`)}`,
    `LOCATION:${esc(input.joinUrl)}`,
    `URL:${input.joinUrl}`,
    `DESCRIPTION:${esc(guestChecklist(input.hostName, input.joinUrl))}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(`Recording with ${input.hostName} in 15 minutes`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
