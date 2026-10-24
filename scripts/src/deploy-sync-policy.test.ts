import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * The sync server is on the open internet. Its write policy (a strfry
 * plugin) lets through only the message kinds Vessel sends, so it cannot be
 * used as a free public server for other apps or filled with spam. The test
 * runs the plugin the way strfry does: one JSON request per line on stdin,
 * one decision per line on stdout.
 */

const PLUGIN = join(__dirname, "../../deploy/strfry-write-policy.mjs");

type Decision = { id: string; action: string; msg?: string };

function decide(kinds: number[]): Promise<Decision[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PLUGIN]);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", () =>
      resolve(out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Decision)),
    );
    for (const kind of kinds) {
      const event = { id: `ev-${kind}`, kind, pubkey: "a".repeat(64), created_at: 1, tags: [], content: "", sig: "" };
      child.stdin.write(
        JSON.stringify({ type: "new", event, receivedAt: 1, sourceType: "IP4", sourceInfo: "203.0.113.7" }) + "\n",
      );
    }
    child.stdin.end();
  });
}

// What the web client publishes: deletions, file records, the relay and
// storage lists, session archives, and the in-call messages.
const VESSEL_KINDS = [5, 1063, 10002, 10063, 30563, 27001, 27002, 27003, 27004, 27005, 27006, 27008];

describe("sync server write policy", () => {
  it("accepts every kind Vessel sends", async () => {
    const decisions = await decide(VESSEL_KINDS);
    expect(decisions.map((d) => [d.id, d.action])).toEqual(VESSEL_KINDS.map((k) => [`ev-${k}`, "accept"]));
  });

  it("rejects other apps' messages with a reason", async () => {
    const decisions = await decide([0, 1, 7, 4, 30023]);
    for (const d of decisions) {
      expect(d.action).toBe("reject");
      expect(d.msg).toMatch(/^blocked: /);
    }
    expect(decisions).toHaveLength(5);
  });
});
