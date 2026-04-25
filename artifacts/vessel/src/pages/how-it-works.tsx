import { ContentPageShell, ContentSection } from "../components/ContentPageShell";

export default function HowItWorks() {
  return (
    <ContentPageShell title="How Vessel works" eyebrow="The plain-English version">
      <p>
        Pull up a chair. Here is how Vessel works, with no jargon and a
        couple of friendly metaphors.
      </p>

      <ContentSection heading="The big idea">
        <p>
          Imagine you and your friends each have a personal tape recorder. You
          all dial into the same call, you each press record on{" "}
          <em>your own</em> recorder, and at the end of the show, everyone&rsquo;s
          clean tape gets quietly mailed to whoever is hosting the episode.
        </p>
        <p>
          That is Vessel. Not &ldquo;everyone shouts into one shared microphone
          in the cloud.&rdquo; Each guest is recorded on their own device, in
          studio quality. The internet only carries a small, lo-fi preview so
          people can see and hear each other in real time.
        </p>
      </ContentSection>

      <ContentSection heading="The building blocks">
        <p>Think of Vessel as four little machines that talk to each other:</p>
        <div className="overflow-x-auto rounded-xl border border-vessel-border bg-vessel-bg-elevated/40 mt-4">
          <table className="w-full text-left border-collapse min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-vessel-border">
                <th className="p-4 font-display font-bold text-vessel-text-primary">
                  The machine
                </th>
                <th className="p-4 font-display font-bold text-vessel-text-primary">
                  What it does
                </th>
                <th className="p-4 font-display font-bold text-vessel-text-primary">
                  Built with
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vessel-border/50">
              <tr>
                <td className="p-4 align-top text-vessel-text-primary font-medium">
                  The studio
                </td>
                <td className="p-4 align-top">
                  The website with the buttons and the record button.
                </td>
                <td className="p-4 align-top">
                  React, Vite, TypeScript, Tailwind CSS.
                </td>
              </tr>
              <tr>
                <td className="p-4 align-top text-vessel-text-primary font-medium">
                  The receptionist
                </td>
                <td className="p-4 align-top">
                  Issues invites, keeps track of who is in which room, sends
                  the host their guests&rsquo; files.
                </td>
                <td className="p-4 align-top">Node.js with Express.</td>
              </tr>
              <tr>
                <td className="p-4 align-top text-vessel-text-primary font-medium">
                  The filing cabinet
                </td>
                <td className="p-4 align-top">
                  Remembers studio names, session titles, and who joined when.
                </td>
                <td className="p-4 align-top">PostgreSQL, accessed via Drizzle.</td>
              </tr>
              <tr>
                <td className="p-4 align-top text-vessel-text-primary font-medium">
                  Your browser
                </td>
                <td className="p-4 align-top">
                  Captures your microphone and camera at full quality, stores
                  the file safely on your device, then ships it.
                </td>
                <td className="p-4 align-top">
                  Just your normal browser, doing what browsers do.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4">
          Notice what is <em>not</em> on that list: no app to install, no
          special plugin, no big media server humming in a data centre holding
          your audio hostage.
        </p>
      </ContentSection>

      <ContentSection heading="Who you are">
        <p>
          When you sign up, Vessel does not ask for an email or a password.
          Instead, your browser quietly generates a{" "}
          <strong className="text-vessel-text-primary">private sign-in key</strong>{" "}
          &mdash; think of it as the only physical key to a safety deposit box.
          That key lives on your device. We never see it.
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-vessel-text-primary">
              There is nothing on our servers to steal.
            </strong>{" "}
            No password database, no email list.
          </li>
          <li>
            <strong className="text-vessel-text-primary">
              You can sign in on a new device
            </strong>{" "}
            by typing in the same key (kind of like writing it on a sticky note
            in your wallet).
          </li>
          <li>
            <strong className="text-vessel-text-primary">
              Lose the key, lose access.
            </strong>{" "}
            Same as if you lost the only key to the safety deposit box. By
            design &mdash; that is the trade-off for privacy.
          </li>
          <li>
            <strong className="text-vessel-text-primary">
              Your studio works on any Vessel server.
            </strong>{" "}
            Your identity is not tied to ours.
          </li>
        </ul>
      </ContentSection>

      <ContentSection heading="How does Vessel know it&rsquo;s really you?">
        <p>
          We do not. Your browser does &mdash; and it proves it on every single request.
        </p>
        <p>
          Every time your studio asks Vessel for something &mdash; &ldquo;list my
          sessions,&rdquo; &ldquo;create a new room,&rdquo; &ldquo;cancel this
          invite&rdquo; &mdash; your browser quietly stamps the request with your private
          sign-in key first. Think of it as a wax seal on a letter: anyone can read whose
          seal it is, but only the person holding the stamp could have made it. Vessel
          checks the seal, sees that it matches your published identity, and lets the
          request through.
        </p>
        <p>
          If anyone else tries to ask for your data &mdash; even if they know your display
          name, even if they guessed your studio&rsquo;s URL &mdash; the seal does not
          check out and Vessel says no. There are no session cookies that can be stolen,
          no passwords to phish, no &ldquo;forgot my login&rdquo; loophole. The proof is
          made fresh on your device for every click, and the key that makes it never
          leaves your laptop.
        </p>
      </ContentSection>

      <ContentSection heading="Where do your recordings actually go?">
        <p>
          When you signed up, Vessel asked you a one-line question:{" "}
          <em>where do your recordings live?</em> You picked one of two answers:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-vessel-text-primary">The community default.</strong>{" "}
            A free, public storage server run by the open-source community. Quick to
            start, no setup, not run by Vessel.
          </li>
          <li>
            <strong className="text-vessel-text-primary">A server you point at.</strong>{" "}
            Any compatible storage server you control or trust &mdash; one you run on a
            cheap VPS, a friend&rsquo;s, your studio&rsquo;s, your university&rsquo;s.
          </li>
        </ul>
        <p>
          Whichever you pick, that is where every recording from your sessions lands. You
          can change your mind any time in Settings, and the change applies to future
          sessions. Vessel itself never touches the bytes.
        </p>
      </ContentSection>

      <ContentSection heading="What happens when you press record">
        <ol className="list-decimal pl-5 space-y-3">
          <li>
            <strong className="text-vessel-text-primary">You make a studio.</strong>{" "}
            Vessel hands you a shareable invite link. You text it to your
            guest.
          </li>
          <li>
            <strong className="text-vessel-text-primary">
              Your guest clicks the link.
            </strong>{" "}
            Their browser opens a page that asks &ldquo;can I use your
            microphone and camera?&rdquo; They say yes.
          </li>
          <li>
            <strong className="text-vessel-text-primary">
              The receptionist plays matchmaker
            </strong>{" "}
            &mdash; it tells your browser and your guest&rsquo;s browser how to
            find each other directly.
          </li>
          <li>
            <strong className="text-vessel-text-primary">
              You both press Record.
            </strong>{" "}
            From this moment on, two things happen in parallel:
            <ul className="list-disc pl-5 mt-2 space-y-2">
              <li>
                A small, compressed audio and video preview zips between you
                so you can have a normal conversation.
              </li>
              <li>
                Each browser quietly saves the <em>full</em> high-quality
                recording to a hidden vault on its own device. Yours stays on
                your laptop. Your guest&rsquo;s stays on theirs.
              </li>
            </ul>
          </li>
          <li>
            <strong className="text-vessel-text-primary">You finish the chat.</strong>{" "}
            Everyone clicks &ldquo;stop.&rdquo;
          </li>
          <li>
            <strong className="text-vessel-text-primary">Delivery time.</strong>{" "}
            Your guest&rsquo;s browser packages up their high-quality file,
            seals it with a code only you (the host) can open, and ships it
            directly to the storage server you picked when you signed up. The
            file does <strong className="text-vessel-text-primary">not</strong>{" "}
            stop over on Vessel&rsquo;s servers.
          </li>
          <li>
            <strong className="text-vessel-text-primary">You open your editor</strong>{" "}
            and there are clean, separated tracks waiting for you.
          </li>
        </ol>
        <p className="mt-4 italic text-vessel-text-muted">
          The slogan version: the conversation streams, the studio masters get
          mailed.
        </p>
      </ContentSection>

      <ContentSection heading="Where the files actually live">
        <p>
          Three different things get stored in three different places:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-vessel-text-primary">
              Your private sign-in key
            </strong>{" "}
            stays in your browser&rsquo;s local memory on your device. Nobody
            else&rsquo;s machine has it.
          </li>
          <li>
            <strong className="text-vessel-text-primary">
              The studio-quality recordings
            </strong>{" "}
            live first on the device that recorded them, then a sealed copy
            is shipped to the storage server the host chose at sign-up.
            That server &mdash; not Vessel &mdash; is where the host&rsquo;s
            edit-ready copies sit, and the host can move them onto a local
            drive or anywhere else from there.
          </li>
          <li>
            <strong className="text-vessel-text-primary">
              Boring metadata
            </strong>{" "}
            (studio names, session titles, when people joined) lives in our
            database, so we can show you a list of past sessions in your
            dashboard.
          </li>
        </ul>
        <p>
          What is <strong className="text-vessel-text-primary">never</strong>{" "}
          on our servers: the actual audio, the actual video, your sign-in
          key, your password (there is not one), your contacts, your
          calendar.
        </p>
      </ContentSection>

      <ContentSection heading="Who owns what">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-vessel-text-primary">
              Each guest owns their own raw recording.
            </strong>{" "}
            It is their voice, their face, their tape.
          </li>
          <li>
            <strong className="text-vessel-text-primary">
              The host owns the assembled session
            </strong>{" "}
            &mdash; the bundle of all the guest tracks they were sent. They
            are the editor and the publisher.
          </li>
          <li>
            <strong className="text-vessel-text-primary">
              Vessel owns nothing about your sessions.
            </strong>{" "}
            We just run the matchmaking service. If we shut down tomorrow,
            every recording you have made still exists, exactly where you put
            it.
          </li>
        </ul>
      </ContentSection>

      <ContentSection heading="What about the links?">
        <p>Two kinds of links you will meet:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-vessel-text-primary">Invite links</strong>{" "}
            (like <code className="font-mono-vessel text-vessel-accent">vessel.app/join/xyz</code>)
            &mdash; single-use codes that let a guest into your studio. They
            expire when the session ends, so you cannot accidentally let
            strangers wander in next week.
          </li>
          <li>
            <strong className="text-vessel-text-primary">Share links</strong>{" "}
            (like <code className="font-mono-vessel text-vessel-accent">vessel.app/s/&hellip;</code>)
            &mdash; when you publish a recording, you can share it with the
            world or with specific people. The link points at the file in the
            location you chose. Revoke the share, the link dies.
          </li>
        </ul>
      </ContentSection>

      <ContentSection heading="What does Vessel's server actually do, then?">
        <p>Honestly? Not much, on purpose. It is the receptionist, not the studio:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Checks the wax-seal signature on every incoming request to make sure it
            really is you asking.
          </li>
          <li>Hands out invite links and tells the right two browsers how to find each other.</li>
          <li>Remembers the names of your studios and sessions so your dashboard is not empty.</li>
          <li>
            Routes the small &ldquo;are you online?&rdquo; and &ldquo;you are
            muted!&rdquo; type messages between participants.
          </li>
          <li>
            Writes a tiny log line for each request: the request id, the
            method, and the path. That is the entire log entry &mdash; no IP
            address, no user agent, no header, no body. (The CDN and hosting
            provider in front of us see standard connection info the way they
            would for any website; that is not something Vessel collects.)
          </li>
        </ul>
        <p>
          That is it. The interesting work &mdash; capturing your voice,
          encoding the audio, storing the file &mdash; all happens inside the
          browsers of the people in the room. Vessel just opens the door and
          gets out of the way. If you want the literal field-by-field list of
          what we store, the{" "}
          <a href="/privacy" className="text-vessel-accent hover:underline">
            Privacy notice
          </a>{" "}
          spells it out.
        </p>
      </ContentSection>

      <ContentSection heading="The one-paragraph summary">
        <p>
          You sign in with a key only you have. You make a studio and invite a
          guest. While you talk, a lightweight preview streams between you in
          real time, but each of you is <em>also</em> recording yourselves at
          studio quality, on your own machine. When you stop, those
          high-quality files are sealed up and shipped directly to you (the
          host). Vessel&rsquo;s servers handle invites and bookkeeping &mdash;
          they never touch the audio. You own the tape. The end.
        </p>
      </ContentSection>
    </ContentPageShell>
  );
}
