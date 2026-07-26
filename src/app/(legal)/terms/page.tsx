import type { Metadata } from "next"

export const metadata: Metadata = { title: "Terms of Service" }

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p>
        These terms govern your use of the Hi-Astrix platform. By creating an account you agree to
        them. This is a working draft and will be replaced with counsel-reviewed terms before
        general availability.
      </p>

      <h2>1. Your account</h2>
      <p>
        You are responsible for the accuracy of the information you provide, for keeping your
        credentials secure, and for all activity that occurs under your workspace. Notify us
        promptly if you believe your account has been accessed without your authorisation.
      </p>

      <h2>2. Acceptable use</h2>
      <p>You agree not to use the platform to:</p>
      <ul>
        <li>Place calls that violate telemarketing, consent or do-not-call regulations in the recipient&apos;s jurisdiction.</li>
        <li>Impersonate a person or organisation you are not authorised to represent.</li>
        <li>Transmit unlawful, fraudulent, harassing or deceptive content.</li>
        <li>Attempt to disrupt, reverse engineer or gain unauthorised access to the service.</li>
      </ul>
      <p>
        You are solely responsible for obtaining any consent required before contacting an
        individual, and for any disclosures your jurisdiction requires regarding automated or
        AI-assisted calling.
      </p>

      <h2>3. Fees and billing</h2>
      <p>
        Usage is billed against your selected package and any purchased credit. Charges are
        calculated on call minutes and applicable per-number fees. Unless stated otherwise, fees are
        non-refundable once consumed.
      </p>

      <h2>4. Service availability</h2>
      <p>
        We work to keep the platform available and performant, but do not warrant uninterrupted
        service. Scheduled maintenance will be communicated in advance where practical.
      </p>

      <h2>5. Termination</h2>
      <p>
        You may close your account at any time. We may suspend or terminate access where these terms
        are breached, where usage creates legal or security risk, or where fees remain unpaid.
      </p>

      <h2>6. Changes</h2>
      <p>
        We may update these terms. Material changes will be notified to the email address on your
        account before they take effect.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href="mailto:support@hiastrix.com">support@hiastrix.com</a>
      </p>
    </>
  )
}
