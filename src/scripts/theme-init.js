;(function () {
    try {
        var root = document.documentElement
        var stored = null
        try {
            stored = window.localStorage.getItem('theme')
        } catch (_) {}

        var theme = stored

        if (!theme) {
            var prefersDark = false
            try {
                prefersDark =
                    window.matchMedia &&
                    window.matchMedia('(prefers-color-scheme: dark)').matches
            } catch (_) {}

            theme = prefersDark ? 'dark' : 'light'

            try {
                window.localStorage.setItem('theme', theme)
            } catch (_) {}
        }

        if (theme === 'light') {
            root.classList.remove('dark')
        } else {
            root.classList.add('dark')
        }
        root.classList.remove('theme-init')
    } catch (_) {}
})()
