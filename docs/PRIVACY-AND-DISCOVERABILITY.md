# Privacy and discoverability

What an outside observer can and cannot learn when a Vessel session is
archived. For operators, security reviewers and users who want the details
before they record.

**Summary:** recordings are encrypted on each participant's device before
upload. The session archive is published as an encrypted record signed by a
single-use key. Without the share link, an observer learns that a Vessel
session was archived at a certain time, with roughly how many tracks, and
nothing else.

## What is published

When a session is archived, Vessel publishes these records to the configured
sync servers. Each archive is signed by a freshly generated key, never the
host's or a guest's key.

**One record per track** with only public, non-identifying fields: a random
identifier, the file type, size and duration, and a label saying it is an
encrypted Vessel track. It contains no URL, hash, name, key or session
reference, and nothing that groups tracks into a session.

**One session record** with a random identifier and a label. Its content is
encrypted with AES-256-GCM under a key made for that archive. The encrypted
content holds the session title, host name, times, and for each track the
participant's name and key, the storage location, the file hash and the key
that decrypts the file.

The archive key travels in the URL fragment of the share link
(`/s/<pointer>#<key>`). Browsers never send fragments to servers, so the key
exists only on devices that hold the link.

## What an observer can see

- That the record comes from Vessel, from its label.
- When it was archived, to within seconds.
- The approximate number of tracks, from the size of the encrypted content.
- The single-use key that signed it.

## What an observer cannot see

- Who hosted or took part, by name or key.
- The session title or any other text.
- Where the recordings are stored, or their contents. Files on the storage
  server are encrypted, each with its own key.
- Whether two archives came from the same host.

## Verifying the single-use key

A signing key used for an archive should have no other activity: no profile,
posts, follows or messages. At most it signs that session's records and,
if the share is revoked, a deletion. Any other activity under that key is a
bug; please report it as described in [SECURITY.md](../SECURITY.md).

## Operator options

- **Run your own sync server.** Set `VESSEL_RELAYS` in `deploy/.env` to
  servers you control (see [OPERATIONS.md](../OPERATIONS.md)). Archives then
  never reach public servers. Recipients must still be able to reach yours.
- **Choose your storage server.** Set `VESSEL_STORAGE_SERVER`. Files are
  encrypted either way; a server that requires signed downloads adds a second
  layer of access control.

## Scope

- **A share link is a key.** Anyone who receives a forwarded link can open the
  archive. Revoking a share removes the published record but cannot recall a
  link already copied.
- **Live sessions** are covered by in-call encryption under a per-session key
  and are outside the scope of this document.

## Reporting

If anything here does not match the deployed code, follow
[SECURITY.md](../SECURITY.md). Please do not open a public issue.
