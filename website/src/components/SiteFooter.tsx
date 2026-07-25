import { Brand } from "./Brand.tsx";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="content site-footer__inner">
        <Brand />
        <p>Quiet the page. Keep the shape.</p>
        <a
          className="source-link"
          href="https://github.com/nicholasgriffintn/chrome-blur"
        >
          View source on GitHub
          <span aria-hidden="true">↗</span>
        </a>
      </div>
    </footer>
  );
}
