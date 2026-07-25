const features = [
  {
    number: "01",
    title: "Set the default",
    description:
      "Choose the websites and blur strength for each profile. Images, videos and sensitive data can be covered before the page finishes drawing.",
    treatment: "media",
  },
  {
    number: "02",
    title: "Teach it the page",
    description:
      "Pick an element once, or select one card and let Blur find every matching card type—even when a site adds more content later.",
    treatment: "sections",
  },
  {
    number: "03",
    title: "Filter with context",
    description:
      "Use focused packs for spoilers, violence and results, then add the shows, characters, teams or phrases that matter to you.",
    treatment: "filters",
  },
  {
    number: "04",
    title: "Hide sensitive data",
    description:
      "Blur labelled personal details, contact information, credentials, payment details and identity numbers in forms and page text.",
    treatment: "privacy",
  },
] as const;

export function FeatureGrid() {
  return (
    <section className="features content" id="features" aria-labelledby="features-title">
      <div className="section-heading">
        <p className="eyebrow">A calmer layer for the web</p>
        <h2 id="features-title">Broad by default. Precise when you need it.</h2>
        <p>
          Start with a simple rule for the whole site, then teach a profile the
          exact components and conditions worth hiding.
        </p>
      </div>

      <div className="feature-grid">
        {features.map((feature) => (
          <article
            className={`feature-card feature-card--${feature.treatment}`}
            key={feature.number}
          >
            <span className="feature-card__number">{feature.number}</span>
            <div className="feature-card__visual" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
