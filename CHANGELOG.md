# Changelog

## UI refresh

A pass over every page for consistency, accessibility and size. No cryptographic logic, data format or network behavior changed.

### Design system
- Color, type, spacing, radius, motion and z-index tokens in `src/styles/global.css`, with light and dark values that all meet WCAG AA contrast. See `DESIGN.md`.
- One shared set of components: buttons, fields, tabs, choice cards, status, output, dropzone, panel, dialog, empty state, disclosure.
- Fonts trimmed from ten files to four. Primary buttons, links and headings no longer fail contrast in light mode.

### Accessibility
- Skip link, a single `main` landmark, `hreflang` alternates, and a global visible focus ring.
- Navigation dropdowns are real buttons with `aria-expanded`; the mobile menu closes on Escape and returns focus.
- Every control has a label, every icon button has a name, errors are tied to their field and announced, results and copy confirmations use live regions.
- Inputs are 16 px so iOS no longer zooms. Touch targets are at least 44 px.
- Long keys, hashes and tokens wrap instead of breaking the layout at 320 px.

### Pages
- Home shows the share form directly, with chat and whiteboard as secondary paths and the tool list below. The separate landing preview redirects home.
- Share and decrypt explain the disabled state, the password, and every failure.
- Every tool page uses the same shell and order: input, options, action, status, result with copy or download.
- Chat and whiteboard create pages explain the password once. Room pages drop the repeated heading, name all controls, add a copy-link action in chat and announce connection state.
- 404 and security pages use the shared page shell.

### Copy
- One vocabulary: Share, Decrypt, Start chat, Open whiteboard, Generate, Copy, Download, Hide, Reveal. Sentence case throughout. Page titles match navigation labels.
- Plain descriptions for the hide-in-image tools and token generator.
- Applied to all seven locales. 142 unused strings removed.

### Rooms
- Aliases are language neutral: each participant sends a seed, and every viewer renders the name in their own language, so a Czech user sees "Jasný Holub" where an English user sees "Bright Dove". Colors derive from the same seed, so they match on every screen.
- The alias is kept per room in the browser, so a reload or reconnect keeps the same name and color.
- Call UI rebuilt in the Discord pattern: dark stage with participant tiles, speaking ring, name pill with mute state, and one bottom bar with microphone, camera, screen, settings and leave. Deafen, devices, volume and per-participant audio live in the settings drawer.
- Whiteboard drawings are clamped to the shared sheet, the sheet is drawn with visible bounds, and the inline board inside chat gets more height.

### Language
- Language is chosen on the server, so it works without JavaScript: an unprefixed page redirects to the language from `Accept-Language` on the first visit, and to the `ec-lang` cookie once you picked a language in the menu. Localized links are served as linked, so a shared `/cs/…` link stays Czech.
- The menu links go through `/_lang/<code>?to=…`, which sets the one-year functional cookie and continues to the page. The cookie holds only the language code. The old `localStorage` redirect in `boot.js` is gone.
- Only unprefixed pages pass through the worker (`run_worker_first` in `wrangler.toml`); assets, APIs and localized pages are served directly.

### Removed
- Two orphaned home components, the landing preview components, the scroll-fade script, no-op animation classes, 27 unused style rules, six font files, and the SVG social image (replaced by `public/og.png`).
