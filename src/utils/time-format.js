export function formatTime(time, format) {
  if (format === void 0) {
    format = 'YY-MM-DD hh:mm:ss';
  }
  if (!time) {
    return '';
  }
  let date;
  if (typeof time === 'number') {
    date = new Date(time);
  } else if (typeof time === 'string') {
    if (/^\d+$/g.test(time)) {
      date = new Date(+time);
    } else {
      date = new Date(time);
    }
  } else {
    date = time;
  }
  const map = {
    M: date.getMonth() + 1,
    D: date.getDate(),
    h: date.getHours(),
    m: date.getMinutes(),
    s: date.getSeconds(),
  };
  return format.replace(/([YMDhms])+/g, function (w, t) {
    const v = map[t];
    if (v !== undefined) {
      if (w.length > 1) {
        return ('0' + v).slice(-2);
      }
      return v;
    } else if ('Y' === t) {
      return (date.getFullYear() + '').slice(-w.length * 2);
    }
    return w;
  });
}
