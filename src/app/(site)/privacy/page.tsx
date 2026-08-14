import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage, { Callout, ContactCard, type LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy | JubileeVerse',
  description:
    'How Jubilee Enterprise LLC collects, uses, shares and protects your personal information on JubileeVerse — including your Jubilee ID account and our AI features.',
  alternates: { canonical: '/privacy' },
};

const EFFECTIVE = 'January 1, 2026';
const UPDATED = 'August 14, 2026';

const sections: LegalSection[] = [
  {
    id: 'scope',
    title: '1. Who we are, and what this covers',
    body: (
      <>
        <p>
          JubileeVerse is operated by Jubilee Enterprise LLC (&ldquo;Jubilee,&rdquo;
          &ldquo;we,&rdquo; &ldquo;us&rdquo;), which is the controller of the personal information
          described here. This policy covers jubileeverse.com and the features you reach from it —
          articles and portals, the news and prayer sections, chat with our Inspire Family personas,
          translation, and your account.
        </p>
        <p>
          It does not cover other websites you reach from ours, or other sites in the Jubilee
          Enterprise Network beyond the account information a shared Jubilee ID necessarily carries
          (see <a href="#jubilee-id">section 8</a>).
        </p>
      </>
    ),
  },
  {
    id: 'information-we-collect',
    title: '2. Information we collect',
    body: (
      <>
        <h3>Information you give us</h3>
        <ul>
          <li>
            <strong>Account details</strong> — first and last name, email address, date of birth,
            and a password, collected when you create a Jubilee ID or sign in with one.
          </li>
          <li>
            <strong>Security settings</strong> — if you turn on two-factor authentication, the
            secret that lets us verify your one-time codes.
          </li>
          <li>
            <strong>What you write</strong> — prayer requests, chat messages, feedback and support
            emails, and anything else you submit.
          </li>
        </ul>

        <h3>Information we collect automatically</h3>
        <ul>
          <li>
            <strong>Device and connection data</strong> — IP address, browser and device type,
            language, referring page and the pages you request, recorded in ordinary server logs.
          </li>
          <li>
            <strong>Security signals</strong> — the result of the Cloudflare Turnstile check that
            runs on our sign-in and sign-up screens, and rate-limiting and abuse-prevention records.
          </li>
          <li>
            <strong>Session data</strong> — the sign-in token that keeps you signed in, stored in
            your own browser.
          </li>
        </ul>

        <h3>Information that stays on your device</h3>
        <p>
          Some things never reach our servers at all. Your feed personalization — the topics you
          follow or block — is saved in your browser&rsquo;s local storage, as are your remembered
          email address, your language choice and small interface preferences. Clearing your browser
          storage erases them.
        </p>

        <Callout>
          <p>
            <strong>We do not run advertising trackers.</strong> JubileeVerse carries no
            third-party ad networks, no advertising pixels and no cross-site behavioural
            advertising, and we have never sold personal information.
          </p>
        </Callout>
      </>
    ),
  },
  {
    id: 'how-we-use',
    title: '3. How we use your information',
    body: (
      <>
        <p>We use personal information to:</p>
        <ul>
          <li>create and maintain your account, and sign you in securely;</li>
          <li>
            deliver the Service — show you articles, answer a chat message, translate a page, take a
            prayer request;
          </li>
          <li>
            send you service email: password resets, security alerts, and notices about changes to
            these policies;
          </li>
          <li>
            keep the Service safe — detect and prevent fraud, abuse, scraping, bot traffic and
            security incidents;
          </li>
          <li>
            understand how the Service is used in aggregate, so we can fix what is broken and
            improve what is not;
          </li>
          <li>comply with the law and enforce our <Link href="/terms">Terms of Use</Link>.</li>
        </ul>
        <p>
          We do not use the content of your prayer requests or chat messages to profile you for
          marketing, and we do not make decisions with legal or similarly significant effects about
          you by automated means alone.
        </p>
      </>
    ),
  },
  {
    id: 'ai-features',
    title: '4. AI features and your conversations',
    body: (
      <>
        <p>
          Several parts of the Service are powered by artificial intelligence: the articles our
          Inspire Family personas write, the chat you can hold with them, and on-demand translation.
        </p>
        <p>
          When you send a chat message or ask for a translation, the text you submit — along with
          the context needed to answer it — is transmitted to a third-party AI model provider that
          generates the response on our behalf. Those providers act as our processors under contract
          and are not permitted to use your content to train their models.
        </p>
        <Callout>
          <p>
            <strong>Please do not type anything into chat that you would not want stored.</strong>{' '}
            Avoid sharing medical details, financial account numbers, government identifiers, or
            information about other people that they have not agreed to share. A chat with an AI
            persona is not a confessional, not a counseling session, and not protected by clergy or
            medical privilege.
          </p>
        </Callout>
        <p>
          We may retain conversation records to operate the feature, investigate abuse, and improve
          quality. Where we use conversations to improve the Service, we work with aggregated or
          de-identified data wherever it will do the job.
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: '5. Cookies and browser storage',
    body: (
      <>
        <p>
          We keep this deliberately small. JubileeVerse relies mainly on your browser&rsquo;s local
          storage rather than cookies, and uses it for:
        </p>
        <ul>
          <li>
            <strong>Authentication</strong> — the token that keeps you signed in, plus the email
            address you asked us to remember;
          </li>
          <li>
            <strong>Preferences</strong> — followed and blocked topics, language selection, and
            layout choices;
          </li>
          <li>
            <strong>Security</strong> — values set by Cloudflare Turnstile to distinguish people from
            bots.
          </li>
        </ul>
        <p>
          None of this is used for advertising or cross-site tracking. You can clear it at any time
          through your browser settings; doing so signs you out and resets your preferences.
        </p>
      </>
    ),
  },
  {
    id: 'sharing',
    title: '6. When we share information',
    body: (
      <>
        <p>
          <strong>We do not sell your personal information, and we do not share it for
          cross-context behavioural advertising.</strong> We disclose it only in these situations:
        </p>
        <ul>
          <li>
            <strong>Service providers</strong> — see <a href="#service-providers">section 7</a>.
          </li>
          <li>
            <strong>Content you choose to publish</strong> — a prayer request or testimony you post
            publicly is visible to others, along with whatever name you attach to it.
          </li>
          <li>
            <strong>Legal reasons</strong> — when we believe in good faith that disclosure is
            required by law, or is necessary to protect the rights, safety or property of Jubilee,
            our members or the public.
          </li>
          <li>
            <strong>Business transfers</strong> — if Jubilee is involved in a merger, acquisition or
            sale of assets, your information may transfer with the Service. We will tell you before
            it becomes subject to a materially different policy.
          </li>
          <li>
            <strong>With your consent</strong> — for anything else.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'service-providers',
    title: '7. Service providers',
    body: (
      <>
        <p>
          We rely on a small set of vendors to run the Service, and share with each only what that
          job requires. They act on our instructions, under contracts that restrict their use of
          your information:
        </p>
        <ul>
          <li>cloud hosting, storage and content delivery;</li>
          <li>the Jubilee ID identity service that authenticates your sign-in;</li>
          <li>email delivery, for password resets and service notices;</li>
          <li>bot protection and denial-of-service defence (Cloudflare);</li>
          <li>AI model providers, as described in <a href="#ai-features">section 4</a>.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'jubilee-id',
    title: '8. Your Jubilee ID across the network',
    body: (
      <p>
        Your account is a Jubilee ID, the shared sign-in for sites in the Jubilee Enterprise
        Network. Core identity information — your name, email address, date of birth, password and
        two-factor settings — is held by that identity service so that one account works everywhere,
        and updating it here updates it network-wide. What you do on JubileeVerse specifically —
        what you read, what you pray, what you write in chat — stays with JubileeVerse and is not
        shared with the other sites.
      </p>
    ),
  },
  {
    id: 'your-rights',
    title: '9. Your choices and rights',
    body: (
      <>
        <p>You can, at any time:</p>
        <ul>
          <li>
            view and correct your name, email and date of birth from your{' '}
            <Link href="/settings">account settings</Link>;
          </li>
          <li>
            change your password there, and enable two-factor authentication on your Jubilee ID;
          </li>
          <li>reset your feed personalization by clearing your browser storage;</li>
          <li>
            delete your account — permanently — from the same settings page, or by writing to{' '}
            <a href="mailto:support@jubileeverse.com">support@jubileeverse.com</a>;
          </li>
          <li>
            ask us for a copy of the personal information we hold about you, ask us to delete it, or
            object to or restrict how we use it.
          </li>
        </ul>
        <p>
          Depending on where you live you may also have the right to data portability, to withdraw
          consent, and to lodge a complaint with your data protection authority. We answer requests
          within the time the law allows, and we will never treat you differently for making one. We
          may need to verify your identity before we act, which usually means confirming control of
          your account email.
        </p>
      </>
    ),
  },
  {
    id: 'retention',
    title: '10. How long we keep information',
    body: (
      <>
        <p>
          We keep personal information only as long as it serves the purpose it was collected for:
        </p>
        <ul>
          <li>
            <strong>Account information</strong> — while your account is open. When you delete your
            account we remove or anonymize it, and purge our backups on their normal rotation.
          </li>
          <li>
            <strong>Prayer requests and chat records</strong> — until you delete them or delete your
            account, except where we must keep a record to resolve a dispute or meet a legal
            obligation.
          </li>
          <li>
            <strong>Server and security logs</strong> — for a limited period, typically measured in
            months, after which they are deleted or aggregated.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'security',
    title: '11. How we protect it',
    body: (
      <>
        <p>
          We encrypt traffic in transit with TLS, store passwords only as salted hashes, offer
          two-factor authentication, restrict internal access to the people who need it, and put bot
          protection and rate limiting in front of our sign-in paths.
        </p>
        <p>
          No system is perfectly secure, and we cannot guarantee absolute security. If a breach ever
          affects your personal information, we will notify you and the relevant authorities as the
          law requires. Please help us: use a unique password, turn on two-factor authentication, and
          tell us immediately if something about your account looks wrong.
        </p>
      </>
    ),
  },
  {
    id: 'children',
    title: '12. Children',
    body: (
      <p>
        JubileeVerse is not directed to children under 13, and we do not knowingly collect personal
        information from them. If you believe a child under 13 has given us personal information,
        write to <a href="mailto:support@jubileeverse.com">support@jubileeverse.com</a> and we will
        delete the account and its data promptly. Parents and guardians of older minors: we
        encourage you to be involved in your child&rsquo;s use of the Service, and you may contact us
        to review or delete their information.
      </p>
    ),
  },
  {
    id: 'international',
    title: '13. International transfers',
    body: (
      <p>
        We operate from the United States, and our providers may process information there and in
        other countries whose data protection laws differ from your own. Where we transfer personal
        information out of the European Economic Area or the United Kingdom, we rely on appropriate
        safeguards such as the European Commission&rsquo;s Standard Contractual Clauses, together
        with the UK Addendum where it applies.
      </p>
    ),
  },
  {
    id: 'state-rights',
    title: '14. US state privacy rights',
    body: (
      <>
        <p>
          If you live in California, Colorado, Connecticut, Virginia or another state with a
          comprehensive privacy law, you may have the right to know what personal information we
          collect and why, to access and delete it, to correct inaccuracies, and to appeal a refusal.
          Exercise any of these through your <Link href="/settings">account settings</Link> or by
          writing to <a href="mailto:support@jubileeverse.com">support@jubileeverse.com</a>.
        </p>
        <p>
          For California residents specifically: in the past twelve months we have collected the
          categories of information described in{' '}
          <a href="#information-we-collect">section 2</a> — identifiers, account and demographic
          details, internet activity, and the contents of what you write to us — for the purposes in{' '}
          <a href="#how-we-use">section 3</a>. We have not sold or shared personal information as
          those terms are defined by the CCPA, and we do not knowingly sell the personal information
          of anyone under 16. An authorized agent may submit a request on your behalf with proof of
          authorization.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: '15. Changes to this policy',
    body: (
      <p>
        We will update this policy as the Service or the law changes. When we do, we revise the
        &ldquo;Last updated&rdquo; date above, and for material changes we give notice through the
        Service or by email before they take effect. Please check back from time to time.
      </p>
    ),
  },
  {
    id: 'contact',
    title: '16. Contact us',
    body: (
      <>
        <p>
          Questions about this policy, or about your information, come straight to us — a person
          reads them.
        </p>
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
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="JubileeVerse · Legal"
      title="Privacy"
      accent="Policy"
      summary="What Jubilee Enterprise LLC collects when you use JubileeVerse, why we collect it, who else ever sees it, and how to take it back."
      effective={EFFECTIVE}
      updated={UPDATED}
      lead={
        <>
          <p>
            The short version: we collect what your account needs and what keeps the site safe, we
            run no advertising trackers, we have never sold personal information, and you can delete
            your account and its data yourself at any time.
          </p>
          <p>
            One thing worth knowing up front — chat messages and translation requests are sent to a
            third-party AI provider to be answered. <a href="#ai-features">Section 4</a> explains
            exactly what that means.
          </p>
        </>
      }
      sections={sections}
      crossLink={{
        href: '/terms',
        label: 'Terms of Use',
        blurb: 'For the agreement that governs your use of the Service, see our',
      }}
    />
  );
}
