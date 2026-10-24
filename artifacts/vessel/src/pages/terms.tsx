import { ContentPageShell, ContentSection } from "../components/ContentPageShell";

export default function Terms() {
  return (
    <ContentPageShell title="Terms of Service" eyebrow="Last updated · April 25, 2026">
      <p>
        These terms govern your use of the Vessel service (the &ldquo;Service&rdquo;). By
        creating a studio or joining a session, you agree to them. The Service is open-source
        software provided free of charge, on an &ldquo;as-is&rdquo; basis, with no warranties
        of any kind.
      </p>

      <ContentSection heading="Your studio, your responsibility">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            You own everything you record with Vessel. You are responsible for obtaining
            consent from your participants before you press record, in accordance with the
            laws that apply to you.
          </li>
          <li>
            You are responsible for the content you create and how you distribute it. If you
            use our storage, we hold your recordings only as files encrypted on your device,
            which we cannot open.
          </li>
          <li>
            You agree not to use the Service for anything illegal, deceptive, harassing, or
            that infringes the rights of others.
          </li>
        </ul>
      </ContentSection>

      <ContentSection heading="Account and access">
        <p>
          There are no paid plans. Your studio is a recovery key that you control.
          Every action you take in the Service &mdash; creating a studio, listing your past
          sessions, cancelling an invite &mdash; is cryptographically signed by your key on
          your device, so the Service can verify it is really you without ever holding your
          key. If you lose the key, we cannot recover access to your studio &mdash; this is
          by design, and is the same property that keeps your account safe from us.
        </p>
      </ContentSection>

      <ContentSection heading="Suspension">
        <p>
          We may suspend or terminate access for any account that abuses the Service, attempts
          to compromise other users, or otherwise breaks these terms.
        </p>
      </ContentSection>

      <ContentSection heading="Storage servers">
        <p>
          Vessel lets you choose where your recordings are stored: the storage provided with
          the hosted Service (the default), a server you operate yourself, or one offered by
          a third party. Recordings are encrypted on your device before upload. We are not
          responsible for the uptime, pricing, retention, content moderation, or terms of a
          storage server we do not operate. The contents of your recordings, the cost of storing them, and the
          consequences of sharing them are your responsibility.
        </p>
      </ContentSection>

      <ContentSection heading="Open source and changes to the Service">
        <p>
          Vessel&rsquo;s source code is published on GitHub under an open-source license. The
          hosted Service may change, pause, or shut down at any time. Each recording is also
          saved on the device that made it, and you can download your files at any time.
          Recordings kept only on the hosted Service&rsquo;s storage may become unavailable if
          it shuts down, so keep copies of anything you need.
        </p>
      </ContentSection>

      <ContentSection heading="Warranty disclaimer">
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
          warranties of any kind, whether express or implied, including merchantability,
          fitness for a particular purpose, and non-infringement.
        </p>
      </ContentSection>

      <ContentSection heading="Limitation of liability">
        <p>
          To the fullest extent permitted by law, Vessel and its contributors are not liable
          for any indirect, incidental, special, consequential, or punitive damages arising
          from your use of the Service. Our total aggregate liability for any claim is limited
          to the amount you paid us in the previous twelve months &mdash; which, for a free
          service, is zero.
        </p>
      </ContentSection>

      <ContentSection heading="Changes to these terms">
        <p>
          We may update these terms from time to time. Material changes will be announced on
          the project&rsquo;s GitHub repository. Your continued use of the Service after a
          change takes effect constitutes acceptance of the updated terms.
        </p>
      </ContentSection>

      <ContentSection heading="Governing law">
        <p>
          These terms are governed by and construed in accordance with the laws of the State
          of Delaware, United States, without regard to its conflict-of-laws principles.
        </p>
      </ContentSection>

      <ContentSection heading="Contact">
        <p>
          Questions:{" "}
          <a href="mailto:info@megistus.xyz" className="text-vessel-accent hover:underline">
            info@megistus.xyz
          </a>
          , or open an issue on the GitHub repository.
        </p>
      </ContentSection>
    </ContentPageShell>
  );
}
