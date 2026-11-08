// Apply the site's saved appearance without loading the public navigation UI.
try {
  if (localStorage.getItem('site-theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
} catch { /* Keep the default light theme when storage is unavailable. */ }
