(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
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

  var toggles = Array.prototype.slice.call(document.querySelectorAll('[data-menu-toggle]'));

  function menuFor(btn) {
    return document.getElementById(btn.getAttribute('aria-controls'));
  }

  function closeMenus(except) {
    toggles.forEach(function (btn) {
      if (btn === except) return;
      var menu = menuFor(btn);
      btn.setAttribute('aria-expanded', 'false');
      if (menu) menu.hidden = true;
    });
  }

  toggles.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var menu = menuFor(btn);
      var open = btn.getAttribute('aria-expanded') === 'true';
      closeMenus(btn);
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (menu) menu.hidden = open;
    });
  });

  var nav = document.getElementById('site-nav');
  var navToggle = document.getElementById('nav-toggle');
  var navLinks = document.getElementById('nav-links');

  function setNav(open) {
    if (!nav || !navToggle) return;
    nav.classList.toggle('nav--open', open);
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && navLinks) {
      var first = navLinks.querySelector('a, button');
      if (first) first.focus();
    }
  }

  if (navToggle) {
    navToggle.addEventListener('click', function () {
      setNav(!nav.classList.contains('nav--open'));
    });
  }

  document.addEventListener('click', function (event) {
    if (!event.target.closest('.nav__group')) closeMenus();
    if (nav && nav.classList.contains('nav--open') && !event.target.closest('#site-nav')) setNav(false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var openBtn = toggles.filter(function (btn) { return btn.getAttribute('aria-expanded') === 'true'; })[0];
    if (openBtn) {
      closeMenus();
      openBtn.focus();
      return;
    }
    if (nav && nav.classList.contains('nav--open')) {
      setNav(false);
      navToggle.focus();
    }
  });

  window.matchMedia('(min-width: 768px)').addEventListener('change', function (e) {
    if (e.matches) setNav(false);
  });
})();
