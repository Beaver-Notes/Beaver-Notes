(function () {
  try {
    var t = localStorage.getItem('theme');
    var m = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var d = t === 'dark' || ((t === 'system' || !t) && m);
    if (d) document.documentElement.classList.add('dark');
    // Runs before first paint; keep in sync for SPA navigations
    var bg = d ? '#171717' : '#ffffff';
    document.documentElement.style.backgroundColor = bg;
    var mc = document.querySelector('meta[name="theme-color"]');
    if (mc) mc.setAttribute('content', bg);
  } catch {}
})();
