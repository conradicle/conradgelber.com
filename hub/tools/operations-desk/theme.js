// Match the site's existing appearance preference without loading its public UI.
try {
  if (localStorage.getItem('site-theme') === 'dark') document.documentElement.dataset.theme = 'dark';
} catch { /* Default to the site's light appearance if storage is unavailable. */ }
