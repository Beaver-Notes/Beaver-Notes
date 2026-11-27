import { describe, expect, it } from 'vitest';
import { isImageOnlyHtml } from '../image-only-html';

// Platform fact the predicate relies on: String.prototype.trim() removes
// U+00A0, so an &nbsp;-only body counts as empty (layout filler, not real
// text). Asserted once below to pin the behavior the &nbsp; case depends on.

const IMG = '<img src="https://example.com/pic.png">';

describe('isImageOnlyHtml', () => {
  it('trims U+00A0 as whitespace (platform behavior underpinning &nbsp; case)', () => {
    expect('\u00A0'.trim()).toBe('');
  });

  it('defers a bare img copy', () => {
    expect(isImageOnlyHtml(IMG)).toBe(true);
  });

  it('defers wrapped-img copies (the D2 residual)', () => {
    expect(isImageOnlyHtml(`<p>${IMG}</p>`)).toBe(true);
    expect(isImageOnlyHtml(`<div>${IMG}</div>`)).toBe(true);
    expect(isImageOnlyHtml(`<div><span>${IMG}</span></div>`)).toBe(true);
    expect(isImageOnlyHtml(`<br>${IMG}`)).toBe(true);
  });

  it('defers comments and whitespace-only nodes around one img', () => {
    expect(isImageOnlyHtml(`<!--x-->${IMG}`)).toBe(true);
    expect(isImageOnlyHtml(`${IMG}<br>`)).toBe(true);
    expect(isImageOnlyHtml(`  ${IMG}  `)).toBe(true);
  });

  it('defers &nbsp;-only bodies (U+00A0 is trimmed)', () => {
    expect(isImageOnlyHtml(`<p>&nbsp;${IMG}</p>`)).toBe(true);
  });

  it('keeps html with real text around the image on the html path', () => {
    expect(isImageOnlyHtml(`<p>Revenue <b>Q1</b>${IMG}</p>`)).toBe(false);
  });

  it('keeps multiple-img copies on the html path', () => {
    expect(isImageOnlyHtml(`${IMG}${IMG}`)).toBe(false);
    expect(isImageOnlyHtml(`<div>${IMG}</div>${IMG}`)).toBe(false);
  });

  it('never defers html without an img', () => {
    expect(isImageOnlyHtml('<p>hello</p>')).toBe(false);
    expect(isImageOnlyHtml('')).toBe(false);
    expect(isImageOnlyHtml('<!-- <img> -->')).toBe(false);
  });
});
