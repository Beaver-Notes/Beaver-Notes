/**
 * Theme initialization and system theme detection - prevents flash and auto-switch issues
 */
export function initializeThemeHandling() {
  if (typeof window !== 'undefined') {
    const storedTheme = localStorage.getItem('theme');

    if (storedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (storedTheme === 'system' || !storedTheme) {
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('dark', systemPrefersDark);
    }
    // If storedTheme is 'light', leave default (no 'dark' class)

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          if (window.__TAURI__ && window.__TAURI__.invoke) {
            window.__TAURI__.invoke('helper:set-theme', {
              theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
            }).catch(() => {});
          }
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }
  return () => {};
}