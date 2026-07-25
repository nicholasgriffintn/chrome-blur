const privacyPoints = [
  "No analytics, telemetry or advertising",
  "No page content written to extension storage",
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
        <p>
          Detection happens inside the tab you are viewing. Blur stores your
          profiles and selectors locally, but never copies, logs or transmits
          the text and field values it checks.
        </p>
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
