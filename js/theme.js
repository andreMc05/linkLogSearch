const STORAGE_KEY = 'theme';

/** @returns {'dark' | 'light'} */
function effectiveTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** @param {'dark' | 'light'} theme */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);
  syncButton(theme);
}

/** @param {'dark' | 'light'} theme */
function syncButton(theme) {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const isDark = theme === 'dark';
  btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  btn.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  const sunEl = btn.querySelector('.icon-sun');
  const moonEl = btn.querySelector('.icon-moon');
  if (sunEl) sunEl.hidden = !isDark;
  if (moonEl) moonEl.hidden = isDark;
}

export function initTheme() {
  const initial = effectiveTheme();
  document.documentElement.setAttribute('data-theme', initial);
  syncButton(initial);

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
  });

  // Keep button icon in sync when system theme changes and no pref is stored
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      syncButton(effectiveTheme());
    }
  });
}
