(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('aos-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('[data-aos]').forEach(function (el) {
      el.classList.add('aos-fade');
      var delay = el.getAttribute('data-aos-delay');
      if (delay) el.classList.add('delay-' + delay);
      observer.observe(el);
    });
  } else {
    document.querySelectorAll('[data-aos]').forEach(function (el) {
      el.classList.add('aos-visible');
    });
  }

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
      var isDark = document.documentElement.classList.toggle('dark');
      document.documentElement.style.colorScheme = isDark ? 'only dark' : 'only light';
      try {
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
      } catch (e) {}
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

  var nav = document.getElementById('site-nav');
  if (nav) {
    var onScroll = function () {
      if (window.scrollY > 10) {
        nav.classList.add('nav-scrolled');
      } else {
        nav.classList.remove('nav-scrolled');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
})();
