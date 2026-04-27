# Privacy & Discoverability of Vessel Session Archives

This document explains exactly what an outside observer can and cannot
learn from the events Vessel publishes to public Nostr relays when a
session is archived. It is intended for operators, security reviewers,
and privacy-conscious users who want to understand the threat model
before they (or their guests) record.

If you only want the takeaway: **encrypted manifests sit on public
relays where anyone can scrape them, but the host's identity, the
participants, the session title, and the recordings themselves stay
inside an AES-256-GCM ciphertext that only people holding the share
link can decrypt.** A scraper learns "a Vessel session was archived
around this time, with roughly N tracks." Nothing more.

---

## 1. What gets published per archived session

Every time a session is archived, Vessel signs and publishes the
following events with a **freshly generated ephemeral keypair** — not
the host's real Nostr identity, not the guests' identities — to the
configured relay set (default: `relay.damus.io`, `nos.lol`,
`relay.nostr.band`; override with `VITE_NOSTR_RELAYS` at build time).

### 1a. Per-track file-metadata event (kind 1063)

One event per recorded track. Public tags carry **only**:

| Tag         | Value                                       | What it leaks                          |
| ----------- | ------------------------------------------- | -------------------------------------- |
| `d`         | `vessel-track-<random8>`                    | A throwaway ID. No link to user/session. |
| `m`         | MIME type, e.g. `video/webm`                | The container format.                  |
| `size`      | bytes                                       | File size.                             |
| `duration`  | seconds                                     | Track length.                          |
| `alt`       | `"Encrypted Vessel session track"`          | "This came from Vessel."               |
| `content`   | empty string                                | Nothing.                               |

**Not present in this event:** the URL of the recording, the integrity
hash, the participant name, the participant pubkey, the session ID, or
any cross-reference to the manifest. The per-track ID is random and
intentionally not derived from anything that would let an outsider
group multiple tracks back into the same session.

### 1b. Session manifest event (kind 30563)

One per session. Public tags carry **only**:

| Tag      | Value                                       | What it leaks                    |
| -------- | ------------------------------------------- | -------------------------------- |
| `d`      | random 16-byte hex identifier               | A throwaway ID.                  |
| `alt`    | `"Encrypted Vessel session archive"`        | "This came from Vessel."         |

The `content` field is an **AES-256-GCM ciphertext** encrypted under a
fresh per-archive symmetric key. The plaintext (only readable by
holders of the share key) contains:

- `sessionTitle`, `hostName`, `endedAt`, `archivedAt`
- For each track: `recordingId`, `participantName`, `participantPubkey`,
  `durationSeconds`, `sizeBytes`, `mimeType`, the storage URL, the
  per-file hash, plus any audio-only / video-only / screen-share
  sibling streams.

The decryption key is encoded in the **URL fragment** of the share
link (`/s/<pointer>#<key>`). Browsers do not transmit fragments in
HTTP requests, the Referer header, or server logs — the key only ever
exists on devices that hold the link.

---

## 2. What an outside observer CAN see

Anyone with relay access (which is to say: anyone) can run a filter
like `kinds: [30563]` against a public relay and pull every Vessel
manifest ever published. From each event they see:

- **It is a Vessel event.** The literal `alt: "Encrypted Vessel
  session archive"` tag fingerprints the application. A scraper can
  count how many Vessel sessions are archived globally per hour, day,
  week — pure traffic analysis, no identities attached.
- **Approximate time of archive.** `created_at` (within seconds of the
  user clicking "End session and archive").
- **Approximate session size.** Ciphertext length is roughly
  `~150 bytes of boilerplate + 400–600 bytes per track`. So:
  - ~600 B–1 KB → 1 track (single participant)
  - ~1–2 KB → 2–3 tracks (small group call)
  - ~5+ KB → large session (podcast / panel)
  This is a fuzzy participant-count estimate, not a number.
- **The ephemeral signing pubkey.** A 32-byte key that signed exactly
  this archive and (usually) the matching kind-1063 file-metadata
  events from the same session.

That is the complete public surface. Everything else is encrypted.

---

## 3. What an outside observer CANNOT see

Without the share key (which lives only in URL fragments held by
intended recipients):

- The host's real Nostr identity, name, or pubkey.
- Any guest's name or pubkey.
- The session title or any descriptive text.
- The URL or hash of any recording.
- Whether a given Nostr account has ever hosted or attended a Vessel
  session.
- Whether two manifest events came from the same host, the same
  organization, or are otherwise related. (Each session uses a brand
  new ephemeral key — they look uncorrelated on the wire.)

---

## 4. How to verify the ephemeral-key property yourself

Anyone reviewing a published manifest event can confirm the signing
key is a single-use ephemeral, not a real identity, by querying the
same relays for *any other activity* under that pubkey.

A throwaway pubkey should have:

- **No profile metadata** (no kind 0).
- **No follows, no DMs, no posts, no reactions** (no kinds 1, 3, 4, 7,
  …).
- **At most**: this one kind-30563 manifest, the matching kind-1063
  file-metadata events from the same session, and possibly a kind-5
  deletion event if the share was later revoked.

If a pubkey associated with a Vessel manifest has *any* unrelated
activity (a profile, posts, follows, prior sessions), the
ephemeral-key invariant has been broken and that's a bug worth filing
under the security policy.

---

## 5. Two known metadata leaks (and how to close them)

The two items in § 2 — the application fingerprint and the fuzzy
participant count — are unavoidable consequences of using public
relays as a transport. They do not expose identities or content, but
operators who care about traffic analysis can mitigate them.

### 5a. Use a private relay

Set `VITE_NOSTR_RELAYS` to a relay you control before building:

```bash
VITE_NOSTR_RELAYS=wss://relay.your-org.example pnpm --filter @workspace/vessel run build
```

The encrypted ciphertext never reaches the public Nostr network.
Anyone scraping `relay.damus.io` et al. sees zero Vessel events from
your deployment. Trade-off: recipients must be able to reach your
private relay, so it must accept anonymous reads from the open
internet (or you must distribute share links with relay hints baked
in — which the share pointer already supports).

### 5b. Pad the ciphertext to a fixed size

Defeats the participant-count estimate. Currently not implemented;
adding it requires padding the JSON plaintext (e.g. to the next 4 KB
boundary) inside `buildEncryptedManifestEvent` in
`artifacts/vessel/src/lib/session-archive.ts` before calling
`encryptManifestContent`. Cost: a small constant amount of extra
bandwidth per archive.

### 5c. Drop or randomize the `alt` tag value

Removes the "Vessel" fingerprint so scrapers can't isolate Vessel
events specifically. Currently the `alt` tag is the literal string
`"Encrypted Vessel session archive"`; replacing it with a generic
value (e.g. `"Encrypted archive"`) would make the events
indistinguishable from any other application using kind 30563.
Trade-off: harder for honest debugging tools and dashboards to
identify event purpose.

---

## 6. Things that are NOT covered by this document

- **Once a recipient holds the share link, they hold the share key
  forever.** Anyone they forward the link to can decrypt the manifest
  and download every blob. There is no per-viewer access control after
  the share leaves the original recipient's hands. This is a property
  of the design, not a leak.
- **Storage server (Blossom) access controls.** Blob URLs inside the
  decrypted manifest are content-addressed and (by default) world-
  readable to anyone who knows the URL. Operators who need stronger
  download gating should run a storage server that requires signed
  authorization on `GET`, not just on `PUT`.
- **Live call signaling and live preview transport.** This document is
  about *archived* sessions only. The live-call signaling channel and
  the live preview server have their own privacy properties; see the
  source under `artifacts/vessel/src/hooks/use-call-signal.ts` and
  `artifacts/vessel/src/lib/moq.ts` for the current behavior.

---

## 7. Reporting an issue

If you believe any of the claims above are false in the deployed code
— e.g. you find a manifest event that leaks a real identity, content
that is not encrypted, or a pubkey that is reused across sessions —
please follow the process in [SECURITY.md](../SECURITY.md). Do not
open a public issue.
