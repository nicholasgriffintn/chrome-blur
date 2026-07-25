import icon from "../assets/icon.svg";

export function Brand() {
  return (
    <a className="brand" href="#top" aria-label="Blur home">
      <img className="brand__icon" src={icon} alt="" width="36" height="36" />
      <span className="brand__name">
        blur<span>.</span>
      </span>
    </a>
  );
}
