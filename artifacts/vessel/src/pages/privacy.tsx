import {
  ContentPageShell,
  ContentSection,
} from "../components/ContentPageShell";

export default function Privacy() {
  return (
    <ContentPageShell
      title="Privacy Notice"
      eyebrow="Last updated · October 24, 2026"
    >
      <p>
        Vessel is open-source software for studio-quality remote recording. We
        have designed it to collect as little about you as possible. Most of
        what makes Vessel work happens on your device, not on our servers.
      </p>

      <ContentSection heading="What our server actually sees">
        <p>
          Below is the literal list of fields that hit our database and our
          application logs. It is not a marketing summary &mdash; it is the
          schema. If you spot a mismatch between this list and the source code,
          please open an issue on GitHub.
        </p>

        <p className="font-display text-vessel-text-primary mt-4 mb-1">
          In our database
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li data-disclosure="sessions">
            <strong className="text-vessel-text-primary">Per session:</strong>{" "}
            the title you gave it, the host&rsquo;s display name and Studio ID,
            the invite code, the current status (waiting / live / ended), the
            participant count, the maximum number of participants allowed in the
            room, and the timestamps for created / started / ended.
          </li>
          <li data-disclosure="participants">
            <strong className="text-vessel-text-primary">
              Per participant:
            </strong>{" "}
            their display name, their Studio ID, their role (host or guest), the
            time they joined, and the time they left (set only when they leave
            the room; cleared again if they rejoin).
          </li>
          <li data-disclosure="deliveries">
            <strong className="text-vessel-text-primary">
              Per guest delivery:
            </strong>{" "}
            when a guest&rsquo;s recording is uploaded, their device sends the
            host a note saying where to find it. We store which session it is
            for, the guest&rsquo;s Studio ID, when it was sent and last updated,
            and the note itself. The note is sealed on the guest&rsquo;s device
            so that only the host&rsquo;s key can open it; we cannot read it.
            Deleting the session deletes its notes.
          </li>
          <li data-disclosure="recordings">
            <strong className="text-vessel-text-primary">
              Per recording (metadata only):
            </strong>{" "}
            the owner&rsquo;s Studio ID, the participant&rsquo;s display name,
            the session it belongs to, the duration, the file size, the format,
            and a pointer (a content hash and a URL) to where the file lives on
            the storage server <em>you</em> chose. If the participant&rsquo;s
            device also recorded separate audio-only, video-only, or
            screen-share tracks, the same file size, format, and pointer are
            stored for each of those tracks, plus the duration of the
            screen-share track. The files themselves are on your storage server,
            and they are encrypted (see below).
          </li>
        </ul>

        <p className="font-display text-vessel-text-primary mt-5 mb-1">
          In our application logs
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            For each request: a request id, the HTTP method, and the path (with
            the query string stripped).
          </li>
          <li>For each response: the status code.</li>
          <li>
            That is the entire log line. There is no IP address, no user agent,
            no header, no body.
          </li>
        </ul>

        <p className="font-display text-vessel-text-primary mt-5 mb-1">
          Not in our database, not in our logs
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>Audio. Video. Anything you said in chat.</li>
          <li>Your recovery key, or the keys that unlock your recordings.</li>
          <li>
            Your IP address or user agent (see the network-edge note below).
          </li>
          <li>Your contacts, your calendar, your location.</li>
          <li>Any third-party analytics, advertising, or tracking pixels.</li>
        </ul>
      </ContentSection>

      <ContentSection heading="The network edge (CDN / hosting provider)">
        <p>
          When your browser makes a connection to Vessel over the internet, the
          network provider in front of us &mdash; the CDN and hosting provider
          &mdash; sees standard connection metadata (your IP address, your user
          agent, the timestamp) the way they would for any website you visit.
          That is a property of how the internet works, not something Vessel
          collects.
        </p>
        <p>
          We do not pull that data into our application, write it to our
          database, or copy it into our logs. Whatever the network and hosting
          provider retain is governed by <em>their</em> policies, not ours, and
          Vessel does not have a 30-day, 60-day, or any other retention claim on
          top of theirs.
        </p>
      </ContentSection>

      <ContentSection heading="The servers that carry a session">
        <p>
          Besides the database above, a session uses three kinds of server. On a
          Vessel instance we host, we run all three; if you self-host or pick
          your own, they are yours.
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-vessel-text-primary">Sync servers</strong>{" "}
            pass messages between people in a session: who is in the room, chat,
            mic and camera state, and the setup for live video. Those messages
            are encrypted on your device with a key made for the session, so the
            sync server sees your Studio ID, the time and your connection
            address, but not what the messages say.
          </li>
          <li>
            <strong className="text-vessel-text-primary">
              The live-video helper
            </strong>{" "}
            (a TURN server) forwards live video between people whose networks
            block a direct connection. It sees connection addresses and the
            amount of data, never the picture or sound: live video is encrypted
            between browsers. Its sign-in is short-lived and tied to your Studio
            ID. Recordings never go through it.
          </li>
          <li>
            <strong className="text-vessel-text-primary">
              Storage servers
            </strong>{" "}
            hold uploaded recordings. Every file is encrypted on the
            participant&rsquo;s device before upload, each with its own key, so
            the storage server &mdash; including ours &mdash; holds only
            scrambled bytes. The key travels only inside the share link, which
            is itself encrypted; it never reaches our database or logs.
          </li>
        </ul>
      </ContentSection>

      <ContentSection heading="What we do not collect">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-vessel-text-primary">
              No account credentials.
            </strong>{" "}
            There is no email or password. Your studio is a recovery key that
            lives on your device. We never see it.
          </li>
          <li>
            <strong className="text-vessel-text-primary">
              Recordings, audio, or video.
            </strong>{" "}
            These are captured on each participant&rsquo;s device, encrypted
            there, and uploaded to the storage server the participant&rsquo;s
            studio uses. They never pass through our application server, and no
            storage server can play them without the key.
          </li>
          <li>
            <strong className="text-vessel-text-primary">
              Your storage server choice.
            </strong>{" "}
            The address of the storage server you pointed Vessel at lives only
            in your browser. We never receive it and never see what you upload
            there.
          </li>
          <li>
            Analytics about how you use the app. No third-party trackers and no
            advertising.
          </li>
          <li>
            Contact lists, location, browsing history, or any device sensor
            beyond the microphone and camera that your browser explicitly grants
            for a session.
          </li>
        </ul>
      </ContentSection>

      <ContentSection heading="How we know a request is really yours">
        <p>
          Vessel does not use sign-in cookies. Each time your studio asks Vessel
          for data, your browser cryptographically signs the request on your
          device using your recovery key. The signature proves the request is
          from you without ever exposing the key. If a request is not signed by
          you, the server refuses it &mdash; even if it claims to be on your
          behalf.
        </p>
      </ContentSection>

      <ContentSection heading="Local storage on your device">
        <p>
          These are kept in your browser&rsquo;s storage and are never
          transmitted to us:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Your recovery key, locked with a random secret that also stays in
            this browser.
          </li>
          <li>Your chosen display name.</li>
          <li>Your light or dark mode choice, if you made one.</li>
          <li>The address of the storage server you pointed Vessel at.</li>
          <li>
            The keys that unlock recordings this device uploaded, and the
            recordings of guests whose share links you opened.
          </li>
          <li>Your recordings, until you clear them.</li>
        </ul>
      </ContentSection>

      <ContentSection heading="Sharing">
        <p>
          We do not sell or rent any of the information above. We will share
          information only when required by valid legal process or when
          necessary to investigate abuse of the service.
        </p>
      </ContentSection>

      <ContentSection heading="Your choices">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Forget this device (Settings) removes your recovery key and studio
            from this browser. Other local data stays until you clear it. Keep
            your recovery key file if you want to sign in again.
          </li>
          <li>
            Delete a session from your lobby. We delete the session, its
            participant list and its delivery notes. Recordings live with you
            and your guests; delete them from your devices and storage.
          </li>
          <li>
            To have everything tied to your Studio ID removed from our database,
            write to the address below.
          </li>
        </ul>
      </ContentSection>

      <ContentSection heading="Open source">
        <p>
          Vessel&rsquo;s source code is published on GitHub. If anything in this
          notice surprises you, you are free to read the code and verify it. The
          two files that back the &ldquo;What our server sees&rdquo; section
          above are{" "}
          <code className="font-mono-vessel text-vessel-accent">
            artifacts/api-server/src/app.ts
          </code>{" "}
          (the log shape) and{" "}
          <code className="font-mono-vessel text-vessel-accent">
            lib/db/src/schema/
          </code>{" "}
          (the database tables).
        </p>
      </ContentSection>

      <ContentSection heading="Contact">
        <p>
          Questions or requests:{" "}
          <a
            href="mailto:info@megistus.xyz"
            className="text-vessel-accent hover:underline"
          >
            info@megistus.xyz
          </a>
          , or open an issue on the GitHub repository.
        </p>
      </ContentSection>
    </ContentPageShell>
  );
}
