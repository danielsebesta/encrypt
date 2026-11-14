(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var flowCache = {};
  var flowFetch = function (url) {
    return flowCache[url] || (flowCache[url] = fetch(url).then(function (r) { return r.text(); }));
  };
  if (!window.matchMedia('(prefers-reduced-data: reduce)').matches && window.fetch && document.querySelector('.flow-bg__base')) {
    var flowTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    flowFetch('/flow-bg-' + flowTheme + '.svg').catch(function () {});
    flowFetch('/flow-sweep-' + flowTheme + '.svg').catch(function () {});
  }
  var mountFlow = function () {
    var root = document.querySelector('.flow-bg');
    if (!root || !root.querySelector('.flow-bg__base') || !window.fetch) return Promise.resolve();
    var theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    return Promise.all([flowFetch('/flow-bg-' + theme + '.svg'), flowFetch('/flow-sweep-' + theme + '.svg')]).then(function (parts) {
      var put = function (el, markup) {
        el.innerHTML = markup;
        var svg = el.firstElementChild;
        if (svg) svg.setAttribute('preserveAspectRatio', 'xMidYMin slice');
      };
      put(root.querySelector('.flow-bg__base'), parts[0]);
      root.querySelectorAll('.flow-bg__img').forEach(function (el) { put(el, parts[1]); });
    }).catch(function () {});
  };
  if (!window.matchMedia('(prefers-reduced-data: reduce)').matches) {
    var flowShown = false;
    var showFlow = function () {
      if (flowShown) return;
      flowShown = true;
      mountFlow().then(function () {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { document.documentElement.classList.add('flow-ready'); });
        });
      });
    };
    ['pointermove', 'keydown', 'scroll', 'touchstart'].forEach(function (name) {
      window.addEventListener(name, showFlow, { once: true, passive: true });
    });
    var later = function () { (window.requestIdleCallback || function (fn) { setTimeout(fn, 100); })(showFlow, { timeout: 600 }); };
    if (document.readyState === 'complete') later(); else window.addEventListener('load', later, { once: true });
  }

  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.setAttribute('aria-pressed', document.documentElement.classList.contains('dark') ? 'true' : 'false');
    themeBtn.addEventListener('click', function () {
      var root = document.documentElement;
      root.classList.add('theme-instant');
      var isDark = root.classList.toggle('dark');
      themeBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      if (document.documentElement.classList.contains('flow-ready')) mountFlow();
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

  function menuItems(menu) {
    return menu ? Array.prototype.slice.call(menu.querySelectorAll('a, button')) : [];
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
    var menu = menuFor(btn);
    var leaveTimer = null;
    btn.addEventListener('click', function (event) {
      var open = btn.getAttribute('aria-expanded') === 'true';
      var pointer = event.detail > 0 && hoverMenus.matches;
      clearTimeout(leaveTimer);
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
    group.addEventListener('focusout', function (event) {
      if (event.relatedTarget && group.contains(event.relatedTarget)) return;
      clearTimeout(leaveTimer);
      setMenu(btn, false);
    });
    btn.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      var items = menuItems(menu);
      if (btn.getAttribute('aria-expanded') !== 'true') {
        clearTimeout(leaveTimer);
        closeMenus(btn);
        setMenu(btn, true);
      }
      var item = event.key === 'ArrowDown' ? items[0] : items[items.length - 1];
      if (item) item.focus();
    });
    if (menu) {
      menu.addEventListener('keydown', function (event) {
        var items = menuItems(menu);
        var index = items.indexOf(document.activeElement);
        if (index === -1) return;
        var next = -1;
        if (event.key === 'ArrowDown') next = Math.min(index + 1, items.length - 1);
        else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        if (next === -1) return;
        event.preventDefault();
        items[next].focus();
      });
    }
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
