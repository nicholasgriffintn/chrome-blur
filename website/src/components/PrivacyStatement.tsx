const privacyPoints = [
  "No analytics, telemetry, advertising or accounts",
  "No page content, field values or media written to storage",
  "No data sold, shared or transmitted externally",
  "No remote scripts or external API calls",
] as const;

export function PrivacyStatement() {
  return (
    <section className="privacy content" id="privacy" aria-labelledby="privacy-title">
      <div className="privacy__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32">
          <path d="M16 3.5 27 8v7.6c0 6.1-4.5 10.5-11 12.9-6.5-2.4-11-6.8-11-12.9V8l11-4.5Z" />
          <path d="m11.5 16 3 3 6.5-7" />
        </svg>
      </div>
      <div className="privacy__copy">
        <p className="eyebrow">Local by design</p>
        <h2 id="privacy-title">Your page never leaves the page.</h2>
        <div className="privacy__policy">
          <p>
            Blur processes the current page URL and, on sites matching an
            enabled profile, visible text, field values, media and page
            attributes. This local processing applies your blur rules and can
            identify personal, payment, authentication and IP address data.
          </p>
          <p>
            Profiles, site patterns, blur settings, trigger terms, labels and
            selectors remain in Chrome&apos;s local extension storage until
            you change them, reset the extension or uninstall it. Backups are
            created only when you request one and remain under your control.
          </p>
          <p>
            Blur never stores the page content it checks or sends user data to
            the developer or another party. Information received through
            Chrome APIs is used only for Blur&apos;s stated purpose and in
            accordance with the Chrome Web Store User Data Policy, including
            the Limited Use requirements. Last updated 26 July 2026.{" "}
            <a href="https://nicholasgriffin.dev/contact">Contact the developer</a>
            {" "}with privacy questions.
          </p>
        </div>
      </div>
      <ul>
        {privacyPoints.map((point) => (
          <li key={point}>
            <span aria-hidden="true">✓</span>
            {point}
          </li>
        ))}
      </ul>
    </section>
  );
}
