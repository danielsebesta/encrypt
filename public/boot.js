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
})();
