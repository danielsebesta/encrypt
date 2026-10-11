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
  var hoverMenus = window.matchMedia('(hover: hover) and (min-width: 768px)');

  function menuFor(btn) {
    return document.getElementById(btn.getAttribute('aria-controls'));
  }

  function setMenu(btn, open) {
    var menu = menuFor(btn);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (menu) menu.classList.toggle('menu--open', open);
  }

  function closeMenus(except) {
    toggles.forEach(function (btn) {
      if (btn !== except) setMenu(btn, false);
    });
  }

  toggles.forEach(function (btn) {
    var group = btn.parentElement;
    var leaveTimer = null;
    btn.addEventListener('click', function (event) {
      var open = btn.getAttribute('aria-expanded') === 'true';
      var pointer = event.detail > 0 && hoverMenus.matches;
      closeMenus(btn);
      setMenu(btn, pointer ? true : !open);
    });
    group.addEventListener('mouseenter', function () {
      if (!hoverMenus.matches) return;
      clearTimeout(leaveTimer);
      closeMenus(btn);
      setMenu(btn, true);
    });
    group.addEventListener('mouseleave', function () {
      if (!hoverMenus.matches) return;
      leaveTimer = setTimeout(function () { setMenu(btn, false); }, 150);
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
