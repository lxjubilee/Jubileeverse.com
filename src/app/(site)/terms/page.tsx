import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage, { Callout, ContactCard, type LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Use | JubileeVerse',
  description:
    'The Terms of Use (EULA) governing your access to JubileeVerse, the faith content and AI features it offers, and your Jubilee ID account.',
  alternates: { canonical: '/terms' },
};

const EFFECTIVE = 'January 1, 2026';
const UPDATED = 'August 14, 2026';

const sections: LegalSection[] = [
  {
    id: 'acceptance',
    title: '1. Acceptance of these Terms',
    body: (
      <>
        <p>
          These Terms of Use (the &ldquo;Terms&rdquo;) are a binding agreement between you and
          Jubilee Enterprise LLC (&ldquo;Jubilee,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;). They
          govern your access to and use of the JubileeVerse website, its articles, portals, feeds,
          prayer and chat features, and everything else we make available at jubileeverse.com (the
          &ldquo;Service&rdquo;).
        </p>
        <p>
          By visiting the Service, creating an account, or ticking the box that says you agree to
          these Terms, you accept them in full. If you do not agree, please do not use the Service.
        </p>
        <p>
          Your use of the Service is also subject to our{' '}
          <Link href="/privacy">Privacy Policy</Link>, which explains what we collect and why. It is
          incorporated into these Terms by reference.
        </p>
      </>
    ),
  },
  {
    id: 'eligibility',
    title: '2. Who may use JubileeVerse',
    body: (
      <>
        <p>
          You must be at least 13 years old to create an account. If you are in the European
          Economic Area or the United Kingdom, you must be at least 16, or the minimum age of
          digital consent in your country if it is lower.
        </p>
        <p>
          If you are under the age of majority where you live, you may use the Service only with the
          involvement and consent of a parent or legal guardian, who agrees to these Terms on your
          behalf and is responsible for your use of the Service.
        </p>
        <p>
          By using the Service you confirm that you are not barred from doing so under any
          applicable law, and that you are not on any sanctions or restricted-party list.
        </p>
      </>
    ),
  },
  {
    id: 'account',
    title: '3. Your Jubilee ID account',
    body: (
      <>
        <p>
          Accounts on JubileeVerse are Jubilee ID accounts. A single Jubilee ID signs you in here and
          at other sites in the Jubilee Enterprise Network, so changes you make to your name, email
          or password may be reflected across those sites.
        </p>
        <p>When you hold an account, you agree to:</p>
        <ul>
          <li>give accurate account details and keep them current;</li>
          <li>keep your password confidential, and not share your account with anyone else;</li>
          <li>
            take responsibility for everything that happens under your account, whether or not you
            authorized it; and
          </li>
          <li>
            tell us promptly at <a href="mailto:support@jubileeverse.com">support@jubileeverse.com</a>{' '}
            if you believe your account has been compromised.
          </li>
        </ul>
        <p>
          Two-factor authentication is available on your Jubilee ID, and we strongly encourage you
          to turn it on. You may close your account at any time from your{' '}
          <Link href="/settings">account settings</Link>.
        </p>
      </>
    ),
  },
  {
    id: 'ai-generated-content',
    title: '4. AI-generated content and the Inspire Family',
    body: (
      <>
        <p>
          Much of what you read on JubileeVerse — articles, devotional writing, study notes,
          summaries, translations, and replies in chat — is produced by artificial intelligence.
          The writing voices of the Inspire Family are <strong>AI personas</strong>. They are not
          real people, not ordained ministers, and not counselors, and no reply from them is a
          pastoral relationship.
        </p>
        <Callout>
          <p>
            <strong>Please verify Scripture for yourself.</strong> AI systems can misquote, misplace
            a citation, or state something with confidence that is simply wrong. Nothing on this
            Service is a substitute for the Bible itself, for your own study, or for the counsel of
            your local church. Where our content and Scripture disagree, Scripture is right and we
            are not.
          </p>
        </Callout>
        <p>
          We review and curate what we publish, but we do not warrant that AI-assisted content is
          accurate, complete, doctrinally sound for your tradition, or suited to your circumstances.
          Use it as a starting point for study and reflection, not as a final authority.
        </p>
      </>
    ),
  },
  {
    id: 'no-advice',
    title: '5. No professional advice',
    body: (
      <>
        <p>
          The Service — including anything in our finance, health, news or prayer sections, and
          anything an AI persona says to you — is offered for general information, encouragement and
          spiritual edification only. It is not professional advice.
        </p>
        <p>
          Nothing here is medical, mental-health, legal, financial, tax or investment advice, and no
          relationship of doctor, therapist, attorney or advisor is created by your use of the
          Service. Always seek a qualified professional before acting on anything you read here.
        </p>
        <Callout>
          <p>
            <strong>If you are in crisis, please reach a human being now.</strong> Call your local
            emergency number, or in the United States call or text 988 to reach the Suicide &amp;
            Crisis Lifeline. Our chat features are not monitored in real time and must never be used
            to report an emergency.
          </p>
        </Callout>
      </>
    ),
  },
  {
    id: 'acceptable-use',
    title: '6. Acceptable use',
    body: (
      <>
        <p>
          JubileeVerse is a place for worship, study and encouragement. You agree not to use the
          Service to:
        </p>
        <ul>
          <li>
            post or transmit anything unlawful, hateful, harassing, obscene, defamatory, or that
            exploits or endangers a child;
          </li>
          <li>
            impersonate another person, an Inspire Family persona, or Jubilee itself, or misrepresent
            your affiliation with anyone;
          </li>
          <li>
            solicit money, promote a business, run a fundraiser, or send unsolicited messages to
            other members;
          </li>
          <li>
            scrape, crawl, harvest, bulk-download or otherwise systematically extract content, or use
            it to train a machine-learning model, without our written permission;
          </li>
          <li>
            probe, scan or test the security of the Service, defeat rate limits or bot protection, or
            access an account, system or data that is not yours;
          </li>
          <li>
            upload malware, interfere with the Service&rsquo;s operation, or place an unreasonable
            load on our infrastructure; or
          </li>
          <li>
            prompt, jailbreak or otherwise manipulate our AI features into producing content that
            violates these Terms or applicable law.
          </li>
        </ul>
        <p>
          You also agree to comply with the technical limits we publish or enforce, including request
          rate limits and any robots directives.
        </p>
      </>
    ),
  },
  {
    id: 'user-content',
    title: '7. Content you submit',
    body: (
      <>
        <p>
          &ldquo;Your Content&rdquo; means anything you submit to the Service: prayer requests, chat
          messages, comments, feedback, your profile details, and any other material you send us.
        </p>
        <p>
          You keep ownership of Your Content. By submitting it, you grant Jubilee a worldwide,
          non-exclusive, royalty-free, sublicensable licence to host, store, reproduce, adapt,
          translate, display and transmit Your Content <strong>for the purpose of operating,
          securing and improving the Service</strong> — for example, to show a prayer request to the
          people you shared it with, to route a chat message to the AI model that answers it, or to
          translate an item you asked to be translated.
        </p>
        <p>
          If you publicly share a prayer request or testimony, you also permit us to display it to
          other members of the community. Please do not include information you would not want a
          stranger to read.
        </p>
        <p>
          You represent that you have the rights to submit Your Content and that it does not
          infringe anyone else&rsquo;s rights or break any law. We may remove Your Content, or
          decline to publish it, at our discretion.
        </p>
        <p>
          Any feedback or suggestion you send us is given freely, and we may use it without
          obligation or compensation to you.
        </p>
      </>
    ),
  },
  {
    id: 'intellectual-property',
    title: '8. Our content and intellectual property',
    body: (
      <>
        <p>
          The Service, and everything in it that is not Your Content — text, articles, imagery,
          audio, design, code, the JubileeVerse and Jubilee Enterprise names, logos and persona
          characters — belongs to Jubilee Enterprise LLC or its licensors and is protected by
          copyright, trademark and other laws.
        </p>
        <p>
          We grant you a personal, revocable, non-transferable, non-exclusive licence to access and
          use the Service for your own devotional, educational and non-commercial use. You may share
          an article link freely, and quote briefly with attribution to JubileeVerse. Everything
          else — republication, redistribution, creating derivative works, or commercial use —
          requires our written permission.
        </p>
        <p>
          Scripture quotations, third-party photography and licensed material remain the property of
          their respective owners and are used under the terms granted to us.
        </p>
        <p>
          If you believe material on the Service infringes your copyright, write to{' '}
          <a href="mailto:support@jubileeverse.com">support@jubileeverse.com</a> with enough detail
          to identify the work, the material in question, and your contact information, and we will
          respond in accordance with applicable law.
        </p>
      </>
    ),
  },
  {
    id: 'third-party',
    title: '9. Third-party links and services',
    body: (
      <>
        <p>
          The Service links to and embeds material from other sites — news sources, Scripture
          resources, images, social sharing and similar. We do not control those sites, we do not
          endorse everything they publish, and we are not responsible for their content, their
          practices or their handling of your data. Your dealings with them are between you and
          them, and their own terms and privacy policies apply.
        </p>
      </>
    ),
  },
  {
    id: 'availability',
    title: '10. Availability and changes to the Service',
    body: (
      <>
        <p>
          We may add, change, suspend or discontinue any part of the Service at any time, including
          features you rely on. We may impose limits on features or restrict access to parts of the
          Service without notice or liability.
        </p>
        <p>
          The Service is offered free of charge, and we do not promise any level of uptime,
          availability or data retention. Please keep your own copy of anything you would be sorry
          to lose.
        </p>
      </>
    ),
  },
  {
    id: 'termination',
    title: '11. Suspension and termination',
    body: (
      <>
        <p>
          You may stop using the Service at any time and delete your account from your{' '}
          <Link href="/settings">account settings</Link>.
        </p>
        <p>
          We may suspend or terminate your access, with or without notice, if we reasonably believe
          you have broken these Terms, if your use exposes us or other members to legal risk or harm,
          or if we are required to do so by law. When your account ends, the licences you granted us
          for Your Content that has already been shared publicly continue, and the sections of these
          Terms that by their nature should survive — ownership, disclaimers, liability, indemnity
          and governing law — do survive.
        </p>
      </>
    ),
  },
  {
    id: 'disclaimers',
    title: '12. Disclaimers',
    body: (
      <>
        <Callout>
          <p>
            THE SERVICE AND ALL CONTENT ARE PROVIDED <strong>&ldquo;AS IS&rdquo;</strong> AND{' '}
            <strong>&ldquo;AS AVAILABLE,&rdquo;</strong> WITHOUT WARRANTY OF ANY KIND. TO THE
            FULLEST EXTENT PERMITTED BY LAW, JUBILEE DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED,
            INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT,
            AND ANY WARRANTY THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, OR THAT
            ITS CONTENT — INCLUDING AI-GENERATED CONTENT AND SCRIPTURE CITATIONS — WILL BE ACCURATE
            OR COMPLETE.
          </p>
        </Callout>
        <p>
          Some jurisdictions do not allow the exclusion of certain warranties, so parts of this
          section may not apply to you. Nothing in these Terms limits rights you have as a consumer
          that cannot be waived under the law of your country.
        </p>
      </>
    ),
  },
  {
    id: 'liability',
    title: '13. Limitation of liability',
    body: (
      <>
        <Callout>
          <p>
            TO THE FULLEST EXTENT PERMITTED BY LAW, JUBILEE ENTERPRISE LLC AND ITS OFFICERS,
            EMPLOYEES, VOLUNTEERS AND SUPPLIERS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
            SPECIAL, CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS,
            REVENUE, DATA, GOODWILL OR OTHER INTANGIBLE LOSSES, ARISING OUT OF OR RELATING TO YOUR
            USE OF — OR INABILITY TO USE — THE SERVICE, WHETHER BASED IN CONTRACT, TORT, STRICT
            LIABILITY OR ANY OTHER THEORY, AND WHETHER OR NOT WE WERE ADVISED OF THE POSSIBILITY OF
            SUCH DAMAGES.
          </p>
          <p>
            OUR TOTAL LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF
            THE AMOUNT YOU PAID US IN THE TWELVE MONTHS BEFORE THE CLAIM AROSE, OR ONE HUNDRED U.S.
            DOLLARS (US$100).
          </p>
        </Callout>
        <p>
          These limits do not apply to liability that cannot lawfully be excluded, including
          liability for death or personal injury caused by negligence, or for fraud.
        </p>
      </>
    ),
  },
  {
    id: 'indemnity',
    title: '14. Indemnity',
    body: (
      <p>
        You agree to indemnify and hold harmless Jubilee Enterprise LLC and its officers, employees
        and volunteers from any claim, demand, loss or expense (including reasonable legal fees)
        arising out of Your Content, your use of the Service, or your breach of these Terms or of
        any law or third-party right.
      </p>
    ),
  },
  {
    id: 'governing-law',
    title: '15. Governing law and disputes',
    body: (
      <>
        <p>
          These Terms are governed by the laws of the United States and of the state in which
          Jubilee Enterprise LLC is organized, without regard to conflict-of-law rules. The courts
          of that state have exclusive jurisdiction over any dispute arising from these Terms or the
          Service, and you consent to their jurisdiction and venue — except that either of us may
          seek injunctive relief in any court of competent jurisdiction to protect intellectual
          property or confidential information.
        </p>
        <p>
          If you live in the European Economic Area, the United Kingdom, or another place whose law
          gives you the right to bring proceedings locally, nothing here takes that right away.
        </p>
        <p>
          Before filing anything, please write to{' '}
          <a href="mailto:support@jubileeverse.com">support@jubileeverse.com</a>. Most disputes are
          settled quickly and in good faith when we simply talk first.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: '16. Changes to these Terms',
    body: (
      <p>
        We may update these Terms as the Service changes or the law requires. When we do, we will
        revise the &ldquo;Last updated&rdquo; date at the top of this page, and for material changes
        we will give notice through the Service or by email before they take effect. Continuing to
        use the Service after a change takes effect means you accept the revised Terms. If you do
        not accept them, please close your account.
      </p>
    ),
  },
  {
    id: 'contact',
    title: '17. Contact us',
    body: (
      <ContactCard>
        <p>
          <strong>Jubilee Enterprise LLC</strong>
        </p>
        <p>
          Email: <a href="mailto:support@jubileeverse.com">support@jubileeverse.com</a>
        </p>
        <p>
          Website: <a href="https://jubileeverse.com">jubileeverse.com</a>
        </p>
      </ContactCard>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="JubileeVerse · Legal"
      title="Terms of"
      accent="Use"
      summary="The agreement between you and Jubilee Enterprise LLC covering your account, the content we publish, and the AI features that help us publish it."
      effective={EFFECTIVE}
      updated={UPDATED}
      lead={
        <>
          <p>
            We have tried to write this in plain language. In short: use JubileeVerse for worship,
            study and encouragement; treat other members with grace; remember that our writing
            voices are AI personas and that Scripture, not this website, is the authority; and know
            that we offer the Service as it is, without warranties.
          </p>
          <p>
            This summary is for orientation only — the sections below are the agreement that
            actually binds us both.
          </p>
        </>
      }
      sections={sections}
      crossLink={{
        href: '/privacy',
        label: 'Privacy Policy',
        blurb: 'For what we collect and how we handle it, see our',
      }}
    />
  );
}
