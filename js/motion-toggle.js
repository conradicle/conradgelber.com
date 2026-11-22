/* The front page's "Pause animation" button. js/jellyfish-lab.js watches its
   aria-pressed and stops the jellyfish when it is true. The button only shows
   while the jellyfish can move: not with reduced motion, not in the light theme
   (which hides them), and not without JS. The choice is remembered. */
(() => {
  const button = document.getElementById('motion');
  if (!button) return;
  const KEY = 'site-motion';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false;
  try { paused = localStorage.getItem(KEY) === 'paused'; } catch (_) { /* storage blocked */ }

  function update() {
    const light = document.documentElement.dataset.theme === 'light';
    button.hidden = reduced.matches || light;
    button.setAttribute('aria-pressed', String(paused || reduced.matches));
  }

  button.addEventListener('click', () => {
    paused = !paused;
    try {
      if (paused) localStorage.setItem(KEY, 'paused');
      else localStorage.removeItem(KEY);
    } catch (_) { /* storage blocked */ }
    update();
  });
  reduced.addEventListener('change', update);
  new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  update();
})();
