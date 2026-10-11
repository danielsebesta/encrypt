(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  document.addEventListener('click', function (event) {
    var anchor = event.target.closest && event.target.closest('a');
    if (!anchor) return;
    var href = anchor.getAttribute('href');
    var target = anchor.getAttribute('target');
    if (
      !href ||
      href.indexOf('http') === 0 ||
      href.indexOf('#') === 0 ||
      href.indexOf('blob:') === 0 ||
      target === '_blank' ||
      anchor.hasAttribute('download')
    ) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;

    var lang = anchor.getAttribute('data-lang');
    if (lang) {
      try {
        localStorage.setItem('ec-lang', lang);
      } catch (e) {}
    }
  });

  function bindThemeToggle(id) {
    var btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', function () {
      var root = document.documentElement;
      root.classList.add('theme-instant');
      var isDark = root.classList.toggle('dark');
      root.style.colorScheme = isDark ? 'only dark' : 'only light';
      try {
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
      } catch (e) {}
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          root.classList.remove('theme-instant');
        });
      });
    });
  }
  bindThemeToggle('theme-toggle');
  bindThemeToggle('theme-toggle-mobile');

  var menuBtn = document.getElementById('mobile-menu-toggle');
  var menu = document.getElementById('mobile-menu');
  var hamburger = document.getElementById('nav-hamburger');
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', function () {
      var isHidden = menu.classList.contains('hidden');
      menu.classList.toggle('hidden', !isHidden);
      menuBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
      if (hamburger) {
        var path = hamburger.querySelector('path');
        if (path) {
          if (isHidden) {
            hamburger.style.transform = 'rotate(-45deg)';
            path.style.strokeDasharray = '20 300';
            path.style.strokeDashoffset = '-32.42px';
          } else {
            hamburger.style.transform = '';
            path.style.strokeDasharray = '12 63';
            path.style.strokeDashoffset = '0';
          }
        }
      }
      document.body.style.overflow = isHidden ? 'hidden' : '';
    });
  }

})();
