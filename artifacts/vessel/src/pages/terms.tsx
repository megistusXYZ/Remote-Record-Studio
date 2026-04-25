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
            You are responsible for the content you create and how you distribute it. We do
            not store your recordings.
          </li>
          <li>
            You agree not to use the Service for anything illegal, deceptive, harassing, or
            that infringes the rights of others.
          </li>
        </ul>
      </ContentSection>

      <ContentSection heading="Account and access">
        <p>
          There are no paid plans. Your identity is a private sign-in key that you control. If
          you lose the key, we cannot recover access to your studio &mdash; this is by design,
          and is the same property that keeps your account safe from us.
        </p>
      </ContentSection>

      <ContentSection heading="Suspension">
        <p>
          We may suspend or terminate access for any account that abuses the Service, attempts
          to compromise other users, or otherwise breaks these terms.
        </p>
      </ContentSection>

      <ContentSection heading="Open source and changes to the Service">
        <p>
          Vessel&rsquo;s source code is published on GitHub under an open-source license. The
          hosted Service may change, pause, or shut down at any time. Because your recordings
          live with you and your guests, your media is not affected if the hosted Service
          becomes unavailable.
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
          <a href="mailto:legal@vessel.example" className="text-vessel-accent hover:underline">
            legal@vessel.example
          </a>
          , or open an issue on the GitHub repository.
        </p>
      </ContentSection>
    </ContentPageShell>
  );
}
