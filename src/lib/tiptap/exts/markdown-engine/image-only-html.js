// True when a clipboard text/html payload is effectively just one image:
// exactly one <img> anywhere in the body (bare or inside wrapper elements)
// and no real text. Comments, <br> and whitespace-only nodes contribute no
// text and defer too; String.prototype.trim() also trims U+00A0, so an
// &nbsp;-only body defers (layout filler, not text). Any real text or a
// second <img> keeps the caller on the html paste path.
export function isImageOnlyHtml(html) {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  return (
    body.querySelectorAll('img').length === 1 && body.textContent.trim() === ''
  );
}
