(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  if ('serviceWorker' in navigator) {
    var register = function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }

  var ua = navigator.userAgent || '';
  var touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  var ios = /iPhone|iPad|iPod/.test(ua) || touchMac;
  var mobile = navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean'
    ? navigator.userAgentData.mobile || touchMac
    : /Android|iPhone|iPad|iPod/.test(ua) || touchMac;
  var installed = navigator.standalone === true ||
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    matchMedia('(display-mode: minimal-ui)').matches;

  var promo = document.getElementById('pwa-promo');
  var notice = document.getElementById('pwa-notice');
  var installButtons = document.querySelectorAll('[data-pwa-install]');
  var deferred = null;
  var promoDismissKey = 'encrypt-pwa-promo-dismissed';

  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  function showInstallButtons() {
    for (var i = 0; i < installButtons.length; i++) show(installButtons[i]);
  }

  function promoDismissed() {
    try { return localStorage.getItem(promoDismissKey) === '1'; } catch (e) { return false; }
  }

  function dismissPromo() {
    hide(promo);
    try { localStorage.setItem(promoDismissKey, '1'); } catch (e) {}
  }

  if (promo && mobile && !installed && !promoDismissed()) {
    show(promo);
    show(promo.querySelector(ios ? '[data-pwa-hint-ios]' : '[data-pwa-hint-menu]'));
  }

  if (promo) {
    var promoClose = promo.querySelector('[data-pwa-promo-dismiss]');
    if (promoClose) promoClose.addEventListener('click', dismissPromo);
  }

  if (notice && !installed) {
    var reason = null;
    try {
      reason = sessionStorage.getItem('encrypt-app-redirect');
      sessionStorage.removeItem('encrypt-app-redirect');
    } catch (e) {}
    if (reason === 'desktop' || reason === 'install') {
      var key = reason === 'desktop' ? 'desktop' : ios ? 'install-ios' : 'install-android';
      var text = notice.querySelector('[data-pwa-notice-text]');
      if (text) text.textContent = notice.getAttribute('data-' + key) || '';
      show(notice);
      if (reason === 'install') showInstallButtons();
    }
  }

  if (notice) {
    var close = notice.querySelector('[data-pwa-notice-dismiss]');
    if (close) close.addEventListener('click', function () { hide(notice); });
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferred = event;
    window.__pwaInstall = function () {
      if (!deferred) return Promise.resolve('unavailable');
      var prompt = deferred;
      deferred = null;
      prompt.prompt();
      return prompt.userChoice.then(function (choice) { return choice && choice.outcome; }, function () { return 'dismissed'; });
    };
    window.dispatchEvent(new CustomEvent('pwa-installable'));
    if (installed || !mobile) return;
    hide(promo && promo.querySelector('[data-pwa-hint-menu]'));
    if (promo && !promoDismissed()) show(promo);
    showInstallButtons();
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    hide(promo);
    hide(notice);
    try { localStorage.removeItem(promoDismissKey); } catch (e) {}
  });

  for (var i = 0; i < installButtons.length; i++) {
    installButtons[i].addEventListener('click', function () {
      if (!deferred) return;
      var prompt = deferred;
      deferred = null;
      prompt.prompt();
      prompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') {
          hide(promo);
          hide(notice);
        }
      }, function () {});
      for (var j = 0; j < installButtons.length; j++) hide(installButtons[j]);
    });
  }
})();
