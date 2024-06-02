/**
 * @param {string} format
 * @param {any} data
 * @return {string}
 */
export function t(format, data) {
  format = (format !== '' && format) || '-';
  if (!data) {
    return format;
  }
  let s = format;
  for (const k in data) {
    s = s.replaceAll(`{${k}}`, data[k]);
  }
  return s;
}
