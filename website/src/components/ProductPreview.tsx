import extensionPreview from "../../../screenshots/screenshot.png";

export function ProductPreview() {
  return (
    <section className="product-preview content" aria-label="Blur extension preview">
      <div className="product-preview__note product-preview__note--profiles">
        <span>01</span>
        One profile for each kind of page
      </div>
      <div className="product-preview__frame">
        <div className="product-preview__bar">
          <span>
            <i />
            <i />
            <i />
          </span>
          <p>Blur / www.bbc.co.uk</p>
          <strong>Local</strong>
        </div>
        <img
          src={extensionPreview}
          alt="Blur configured on a news website, with images and sensitive sections obscured"
          width="1786"
          height="1578"
        />
      </div>
      <div className="product-preview__note product-preview__note--shape">
        <span>02</span>
        Quiet the detail. Keep the shape.
      </div>
    </section>
  );
}
