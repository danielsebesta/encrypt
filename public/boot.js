(function () {
  var root = document.documentElement;
  root.classList.add('theme-instant');
  try {
    var t = localStorage.getItem('theme');
    var d = t === 'dark' || (!t && matchMedia('(prefers-color-scheme:dark)').matches);
    if (d) root.classList.add('dark');
    root.style.colorScheme = d ? 'only dark' : 'only light';
  } catch (e) {}
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      root.classList.remove('theme-instant');
    });
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }

  try {
    var cur = document.documentElement.lang || 'en';
    var stored = localStorage.getItem('ec-lang');
    var locales = ['en', 'cs', 'de', 'es', 'fr', 'sk', 'pl'];
    if (stored && locales.indexOf(stored) !== -1 && stored !== cur) {
      var p = location.pathname;
      var hasPayload = !!location.hash || new URLSearchParams(location.search).has('p');
      var isDecryptRoute = p === '/u' || p === '/u/';
      for (var j = 1; j < locales.length; j++) {
        if (p.indexOf('/' + locales[j] + '/u') === 0) {
          isDecryptRoute = true;
          break;
        }
      }
      if (isDecryptRoute && hasPayload) {
        localStorage.setItem('ec-lang', cur);
        return;
      }
      for (var i = 0; i < locales.length; i++) {
        if (locales[i] === 'en') continue;
        if (p.indexOf('/' + locales[i] + '/') === 0) {
          p = p.slice(locales[i].length + 1) || '/';
          break;
        }
        if (p === '/' + locales[i]) {
          p = '/';
          break;
        }
      }
      var np = stored === 'en' ? p : p === '/' ? '/' + stored + '/' : '/' + stored + p;
      if (np !== location.pathname) {
        location.replace(np + location.search + location.hash);
        return;
      }
    }
    localStorage.setItem('ec-lang', cur);
  } catch (e) {}
})();
