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

### Removed
- Two orphaned home components, the landing preview components, the scroll-fade script, no-op animation classes, 27 unused style rules, six font files, and the SVG social image (replaced by `public/og.png`).
