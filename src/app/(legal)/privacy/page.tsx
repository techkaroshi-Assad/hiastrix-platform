import type { Metadata } from "next"

export const metadata: Metadata = { title: "Privacy Policy" }

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>
        This policy explains what Hi-Astrix collects, why, and what control you have over it. This
        is a working draft and will be replaced with a counsel-reviewed policy before general
        availability.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data</strong> — your name, work email, company name and role.</li>
        <li><strong>Usage data</strong> — call metadata such as timestamps, duration, destination country and outcome.</li>
        <li><strong>Call content</strong> — recordings and transcripts, only where you enable them for a given agent.</li>
        <li><strong>Billing data</strong> — package, balance and payment records. Card details are handled by our payment processor and never stored on our systems.</li>
        <li><strong>Technical data</strong> — IP address, browser and device information used for security and diagnostics.</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        To operate your workspace, place and receive calls on your instruction, bill accurately,
        detect abuse, and provide support. We do not sell your data, and we do not use your call
        content to train models.
      </p>

      <h2>Recordings and transcripts</h2>
      <p>
        Recording is off by default and enabled per agent by you. Where you enable it, you are
        responsible for meeting the notice and consent requirements of every jurisdiction you call
        into. You can disable recording, and request deletion of stored recordings, at any time.
      </p>

      <h2>Retention</h2>
      <p>
        Call metadata is retained for the life of your account for billing and audit purposes.
        Recordings and transcripts are retained according to your workspace setting. Closing your
        account triggers deletion of workspace content within 30 days, except where longer retention
        is legally required.
      </p>

      <h2>Sub-processors</h2>
      <p>
        We use third-party infrastructure providers for hosting, telephony, speech processing,
        payments and email delivery. Each is bound by contract to process data only on our
        instruction. A current list is available on request.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on your jurisdiction you may request access to, correction of, export of, or
        deletion of your personal data. Write to us and we will respond within the period your law
        requires.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit and at rest. Access to production systems is restricted and
        logged. Report a suspected vulnerability to the address below.
      </p>

      <h2>Contact</h2>
      <p>
        Privacy enquiries: <a href="mailto:privacy@hiastrix.com">privacy@hiastrix.com</a>
      </p>
    </>
  )
}
