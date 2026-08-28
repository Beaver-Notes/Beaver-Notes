(function () {
  var t = localStorage.getItem('theme');
  if (t === 'dark') {
    document.documentElement.classList.add('dark');
  } else if (t === 'system' || !t) {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
  }
})();
(function () {
  var t = localStorage.getItem('theme');
  var isDark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var bg = isDark ? '#171717' : '#fafafa';
  document.documentElement.style.backgroundColor = bg;
  if (document.body) document.body.style.backgroundColor = bg;
})();
