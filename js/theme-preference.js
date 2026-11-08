// Apply the saved appearance before the page is painted.
try {
  document.documentElement.dataset.theme = localStorage.getItem('site-theme') === 'light' ? 'light' : 'dark';
} catch { document.documentElement.dataset.theme = 'dark'; }
