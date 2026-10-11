# Design system

This file is the contract for every page and component on encrypt.click. Use the tokens and classes here instead of inventing new ones. Everything lives in `src/styles/global.css`.

## Tokens

Colors are CSS custom properties on `:root` (light) and `html.dark` (dark). Tailwind utilities map to them through `@theme inline`, so `text-muted`, `bg-surface`, `border-line` and friends work in markup without dark variants.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#ffffff` | `#09090b` | page background |
| `--surface` | `#fafafa` | `#18181b` | panels, outputs, fields |
| `--surface-2` | `#f4f4f5` | `#27272a` | tabs track, hover fills |
| `--line` | `#d4d4d8` | `#3f3f46` | field and card borders |
| `--line-soft` | `#e4e4e7` | `#27272a` | dividers, panel borders |
| `--text` | `#18181b` | `#f4f4f5` | body text |
| `--muted` | `#52525b` | `#a1a1aa` | secondary text, hints |
| `--accent` | `#007a4f` | `#3cd292` | buttons, links, selected state |
| `--accent-strong` | `#00603d` | `#75e5ae` | button hover, text on accent-weak |
| `--accent-weak` | `#e9fcf1` | `#0a281a` | success and result backgrounds |
| `--accent-line` | `#a9f1ca` | `#154b33` | success borders |
| `--on-accent` | `#ffffff` | `#09090b` | text on `--accent` |
| `--warn` / `--warn-weak` | `#b45309` / `#fffbeb` | `#fbbf24` / `#1f1a0b` | password and private key warnings |
| `--danger` / `--danger-weak` | `#b91c1c` / `#fef2f2` | `#f87171` / `#2a1111` | errors |

Every text and background pair above meets 4.5:1. Brand green `#00bc7d` is reserved for the logo and icon strokes. It is never used under light-mode text.

**Type.** Nunito for everything at 400, 700 and 900. Fira Code 400 for keys, hashes, tokens and links. Four font files ship, no more. Sizes: `text-sm` (14 px) for labels, hints and status, `text-base` (16 px) for body, buttons and every input, `text-lg` for section titles, `.page-title` for the single page heading (clamped 28 to 36 px). Headings are one color. Labels are sentence case. Inputs are never smaller than 16 px.

**Spacing.** 4, 8, 12, 16, 24, 32, 48, 64 px. Use `.stack` (24 px gaps) for form flow and `.field` (6 px gaps) inside a control group.

**Radii.** 8 px (`rounded-lg`) for controls and fields, 12 px (`rounded-xl`) for panels, dialogs and menus. Full radius only for status dots and avatars.

**Shadow.** One token, `--shadow-float`, on floating surfaces only: dropdown menus and dialogs.

**Motion.** `--duration-fast` (150 ms) with `--ease-out` on color and opacity. `--duration-dialog` (200 ms) for the dialog. `prefers-reduced-motion` turns every animation and transition off globally.

**Layers.** `--z-nav` 10, `--z-menu` 20, `--z-dialog` 30, `--z-toast` 40.

## Components

| Class | What it is |
|---|---|
| `.btn` | primary action, one per view, `--accent` background |
| `.btn-secondary` | outlined alternative action |
| `.btn-ghost` | low emphasis, icon buttons and inline actions |
| `.btn-sm`, `.btn-icon` | size and icon-only modifiers; icon-only buttons always carry `aria-label` |
| `.field` + `.label` + `.input` + `.hint` | one control: label bound with `for`, hint linked with `aria-describedby`, `aria-invalid` on error |
| `.passphrase` | input with an inline regenerate button |
| `.tabs` + `.tab` | segmented mode switch with `role="tablist"` and `aria-selected` |
| `.choice-list` + `.choice` | radio cards |
| `.status` | inline state with `--ok`, `--warn`, `--error`, `--busy`; errors use `role="alert"`, results use `role="status"` |
| `.output` | monospace result that wraps anywhere; `--ok` for decrypted or generated results, `--secret` for private keys, `--scroll` for long keys |
| `.output-head` | label on the left, copy and secondary actions on the right |
| `.dropzone` | file input as a `<label>` with the real input visually hidden; `--active` when a file is loaded |
| `.panel` | the one card on a page |
| `.dialog` | `<dialog>` with `__panel`, `__head`, `__title`, `__body` |
| `.empty` | empty state with `__title` |
| `.more` | `<details>` disclosure for advanced options |
| `.steps` | numbered how-it-works list, only for real sequences |
| `.help-trigger` | the `?` next to a page title, opens `ToolHelp.svelte` |

`CopyButton.svelte` is the only copy control. It takes `text`, `label` and `copiedLabel` and announces the change.

## Page template

Every tool page uses the same shell:

```
.page (or .page--wide for two-column tools)
  header.page-head
    h1.page-title  + ToolHelp
    p.page-lead
  .panel
    tabs (if the tool has modes)
    fields
    .more (advanced options)
    .btn (primary action)
    .status (error, busy, success)
    .field > .output-head + .output (result with copy or download)
```

Content is left-aligned. The primary action is the only `.btn` in the panel. Download and "another" actions are `.btn-secondary`.

## Writing

- One name per concept: share, decrypt, chat, whiteboard, generate, copy, download, hide, reveal. Encode and decode only for Base64.
- Buttons are verbs that name the outcome: "Encrypt and share", "Generate new token", "Reveal message".
- Sentence case everywhere. No tracked all-caps labels.
- Page titles match the navigation label exactly.
- Errors say what happened and what to do, in one sentence. No apologies, no jargon.
- Security notes are one sentence at the moment they matter, for example under the password field.
- Every string lives in `src/locales/*.json`. `en.json` is the source of truth and the other six files carry the same keys.

## Adding a tool

1. Create the Svelte component in `src/components/tools/` using only the classes above.
2. Copy any file in `src/pages/tools/` and change the component import and the `tools.<name>` prefix.
3. Register the slug in `src/lib/tools.ts`.
4. Add `nav.tool.<name>`, `tools.<name>.h1`, `.subtitle`, `.meta.title`, `.meta.description` and `.help.what`, `.help.safe`, `.help.watchOut` to all seven locale files. The `h1` is the same text as the navigation label.
