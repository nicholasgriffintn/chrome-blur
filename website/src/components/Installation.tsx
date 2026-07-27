import { DownloadButton } from "./DownloadButton.tsx";
import { ReleaseProvenance } from "./ReleaseProvenance.tsx";

const steps = [
  {
    title: "Add Blur to Chrome",
    description: "Install the extension from the Chrome Web Store.",
  },
  {
    title: "Choose your first site",
    description: "Open Blur on a normal website, then select Use this site.",
  },
  {
    title: "Tune what gets through",
    description: "Adjust the profile, pick page content and set the blur strength.",
  },
] as const;

export function Installation() {
  return (
    <section className="installation content" id="install" aria-labelledby="install-title">
      <div className="installation__copy">
        <p className="eyebrow">Install from Chrome</p>
        <h2 id="install-title">Ready in three small steps.</h2>
        <p>
          Install Blur from the Chrome Web Store, or use the download menu for
          a ZIP you can load manually.
        </p>
        <DownloadButton />
        <ReleaseProvenance />
      </div>
      <ol className="steps">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="steps__number">0{index + 1}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
