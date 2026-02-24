(function () {
    const theme = localStorage.getItem('theme');
    if (theme === 'light') document.documentElement.classList.remove('dark');
})();
