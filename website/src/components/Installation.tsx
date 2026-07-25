import { DownloadButton } from "./DownloadButton.tsx";

const steps = [
  {
    title: "Download and unzip Blur",
    description: "Keep the extracted extension folder somewhere you will not delete.",
  },
  {
    title: "Open Chrome extensions",
    description: "Visit chrome://extensions and switch on Developer mode.",
  },
  {
    title: "Load the extension",
    description: "Select Load unpacked, then choose the extracted Blur folder.",
  },
  {
    title: "Choose your first site",
    description: "Open Blur, select Use this site and adjust the profile to suit the page.",
  },
] as const;

export function Installation() {
  return (
    <section className="installation content" id="install" aria-labelledby="install-title">
      <div className="installation__copy">
        <p className="eyebrow">Install locally</p>
        <h2 id="install-title">Ready in four small steps.</h2>
        <p>
          Blur is a dependency-free Manifest V3 extension. Chrome loads it
          directly from the folder on your computer.
        </p>
        <DownloadButton />
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
