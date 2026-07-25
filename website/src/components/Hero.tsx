import { DownloadButton } from "./DownloadButton.tsx";

export function Hero() {
  return (
    <section className="hero content" aria-labelledby="hero-title">
      <div className="hero__copy">
        <p className="eyebrow reveal">
          <span className="status-dot" />
          Local-only Chrome extension
        </p>
        <h1 className="hero__title reveal reveal--one" id="hero-title">
          Choose what <em>gets through.</em>
        </h1>
        <p className="hero__intro reveal reveal--two">
          Blur distracting images, sensitive details and entire page sections
          on the websites you choose—before they reach your screen share,
          recording or line of sight.
        </p>
        <div className="hero__actions reveal reveal--three">
          <DownloadButton />
          <a className="text-link" href="#features">
            See how it works
            <span aria-hidden="true">↓</span>
          </a>
        </div>
      </div>

      <aside className="hero__sample reveal reveal--two" aria-label="Blur example">
        <p className="sample__label">On this page</p>
        <article className="sample-card sample-card--blurred">
          <span className="sample-card__image" />
          <span>
            <i />
            <i />
          </span>
          <span className="sample-card__reveal">Reveal</span>
        </article>
        <article className="sample-card">
          <span className="sample-card__image sample-card__image--clear" />
          <span>
            <strong>Everything stays in place.</strong>
            <small>Only the detail is hidden.</small>
          </span>
        </article>
        <div className="sample__footer">
          <span className="status-dot" />
          Blur active
          <b>65%</b>
        </div>
      </aside>

      <dl className="hero__facts reveal reveal--three">
        <div>
          <dt>No tracking</dt>
          <dd>Nothing to analyse</dd>
        </div>
        <div>
          <dt>No account</dt>
          <dd>Nothing to sign into</dd>
        </div>
        <div>
          <dt>No licence key</dt>
          <dd>Nothing to activate</dd>
        </div>
      </dl>
    </section>
  );
}
