;(function () {
    try {
        var root = document.documentElement
        var stored = null
        try {
            stored = window.localStorage.getItem('theme')
        } catch (_) {}
        var theme =
            stored ||
            (window.matchMedia &&
            window.matchMedia('(prefers-color-scheme: dark)').matches
                ? 'dark'
                : 'light')
        if (theme === 'light') {
            root.classList.remove('dark')
        } else {
            root.classList.add('dark')
        }
    } catch (_) {}
})()

