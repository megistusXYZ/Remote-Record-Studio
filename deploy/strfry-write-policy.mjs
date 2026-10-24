#!/usr/bin/env node
// Write policy for the strfry sync server (relay.writePolicy.plugin in
// strfry.conf). strfry sends one JSON request per line on stdin and reads
// one decision per line on stdout. Only the message kinds the Vessel web
// client publishes are accepted, so the server can't be used as a free
// public relay for other apps. Checked by
// scripts/src/deploy-sync-policy.test.ts; keep in step with the client.
import { createInterface } from "node:readline";

const ALLOWED = new Set([
  5, // deletion: taking down a share
  1063, // file record for an archived track
  10002, // the studio's sync server list
  10063, // the studio's storage server list
  30563, // encrypted session archive
  27001, 27002, 27003, 27004, 27005, 27006, 27008, // in-call messages
]);

const lines = createInterface({ input: process.stdin, terminal: false });
lines.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return; // Not a request strfry would send; nothing to answer.
  }
  const event = request?.event ?? {};
  const decision = ALLOWED.has(event.kind)
    ? { id: event.id, action: "accept" }
    : { id: event.id, action: "reject", msg: "blocked: this server only relays Vessel sessions" };
  process.stdout.write(JSON.stringify(decision) + "\n");
});
