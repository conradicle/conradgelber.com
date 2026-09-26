// Photo carousel on /off-the-clock/. The markup is a CSS scroll-snap strip
// that works on its own; this adds Prev/Next buttons, a "2 of 4" position
// readout and left/right arrow keys. No autoplay. Loaded as a same-origin
// file because the CSP (see _headers) blocks inline scripts.
(function () {
  var root = document.querySelector('.carousel');
  if (!root) return;
  var track = root.querySelector('.carousel-track');
  var slides = track.querySelectorAll('.slide');
  var controls = root.querySelector('.carousel-controls');
  var status = root.querySelector('.carousel-status');
  var count = slides.length;
  var current = 0;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Nearest slide to the track's left edge; the last slide can't reach the
  // left edge (it is only 85% wide), so a fully scrolled track counts as last.
  function nearest() {
    var x = track.scrollLeft;
    if (x >= track.scrollWidth - track.clientWidth - 2) return count - 1;
    var best = 0;
    for (var i = 1; i < count; i++) {
      if (Math.abs(slides[i].offsetLeft - track.offsetLeft - x) <
          Math.abs(slides[best].offsetLeft - track.offsetLeft - x)) best = i;
    }
    return best;
  }

  function announce(i) {
    if (i === current && status.textContent) return;
    current = i;
    status.textContent = (i + 1) + ' of ' + count;
  }

  function goTo(i) {
    i = (i + count) % count;
    track.scrollTo({
      left: slides[i].offsetLeft - track.offsetLeft,
      behavior: reduceMotion.matches ? 'auto' : 'smooth'
    });
    announce(i);
  }

  root.querySelector('.carousel-prev').addEventListener('click', function () { goTo(current - 1); });
  root.querySelector('.carousel-next').addEventListener('click', function () { goTo(current + 1); });

  root.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1); }
  });

  // Swipes and trackpad scrolls: update the readout once scrolling settles,
  // so a screen reader hears the slide it landed on, not every one it passed.
  var settle;
  track.addEventListener('scroll', function () {
    clearTimeout(settle);
    settle = setTimeout(function () { announce(nearest()); }, 120);
  }, { passive: true });

  controls.hidden = false;
})();
