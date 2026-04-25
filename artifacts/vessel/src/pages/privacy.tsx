import { LegalPageShell, LegalSection } from "../components/LegalPageShell";

export default function Privacy() {
  return (
    <LegalPageShell title="Privacy Notice" lastUpdated="Last updated · April 25, 2026">
      <p>
        Vessel is open-source software for studio-quality remote recording. We have designed it
        to collect as little about you as possible. Most of what makes Vessel work happens on
        your device, not on our servers.
      </p>

      <LegalSection heading="What we collect">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-vessel-text-primary">No account credentials.</strong>{" "}
            There is no email or password. Your identity is a private sign-in key that lives on
            your device. We never see it.
          </li>
          <li>
            <strong className="text-vessel-text-primary">Display name.</strong> The name you
            choose when you create your studio. It is shown to guests you invite.
          </li>
          <li>
            <strong className="text-vessel-text-primary">Session metadata.</strong> The titles
            of sessions you create and the times participants joined or left, so we can route
            invites and show your studio history.
          </li>
          <li>
            <strong className="text-vessel-text-primary">Server logs.</strong> Standard request
            logs (IP address, user agent, timestamp) used for security and abuse prevention.
            Retained for up to thirty days, then deleted.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="What we do not collect">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Recordings, audio, or video. These are captured on each participant&rsquo;s device
            and delivered straight to the host. They never touch our servers.
          </li>
          <li>Analytics about how you use the app. No third-party trackers and no advertising.</li>
          <li>
            Contact lists, location, browsing history, or any device sensor beyond the
            microphone and camera that your browser explicitly grants for a session.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Cookies and local storage">
        <p>
          We use a single session cookie to keep you signed in across page loads. Your private
          sign-in key is stored locally in your browser and is never transmitted to us.
        </p>
      </LegalSection>

      <LegalSection heading="Sharing">
        <p>
          We do not sell or rent any of the information above. We will share information only
          when required by valid legal process or when necessary to investigate abuse of the
          service.
        </p>
      </LegalSection>

      <LegalSection heading="Your choices">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Sign out at any time. Your local data remains on your device until you clear it.
          </li>
          <li>
            Delete your studio. We remove your display name and session metadata. Recordings
            live with you and your guests, not with us.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Open source">
        <p>
          Vessel&rsquo;s source code is published on GitHub. If anything in this notice
          surprises you, you are free to read the code and verify it.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions or requests:{" "}
          <a
            href="mailto:privacy@vessel.example"
            className="text-vessel-accent hover:underline"
          >
            privacy@vessel.example
          </a>
          , or open an issue on the GitHub repository.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
