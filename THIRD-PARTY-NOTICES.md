# Third-party notices

Attributions for icons and fonts shipped with this site. Other open-source dependencies are listed with their licenses in `package.json`.

## Tabler Icons

Tabler Icons by Paweł Kuna, licensed under the MIT License:

https://github.com/tabler/tabler-icons/blob/main/LICENSE

Source: https://github.com/tabler/tabler-icons

Delivered through the npm package `@iconify-json/tabler` (version 1.2.45). This site uses the filled variant wherever Tabler has one, and the outline variant only where no filled icon fits. The SVG paths are inlined unmodified; the site only sets size and currentColor. One exception: Tabler has no filled Android logo, so `src/lib/iconExtras.ts` adds a filled version drawn on the geometry of Tabler's `brand-android`, under the same MIT license.

## Allo

Copyright 2026 Josh Puckett (https://github.com/joshpuckett/allo), based on Inter, Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter)

Licensed under the SIL Open Font License, Version 1.1. The font authors declare no Reserved Font Name. The full license text is served at `/fonts/OFL-allo.txt` (`public/fonts/OFL-allo.txt`).

The shipped files are a subset: Latin and Latin Extended only, restricted to weight 400 to 700, with roundness fixed at 50 and optical size at 14.

## Commit Mono

Copyright 2023 Commit Mono authors (https://github.com/eigilnikolajsen/commit-mono)

Licensed under the SIL Open Font License, Version 1.1. The font authors declare no Reserved Font Name. The full license text is served at `/fonts/OFL-commit-mono.txt` (`public/fonts/OFL-commit-mono.txt`).

The shipped files are the 400, 500 and 700 weights, subset to Latin and Latin Extended.

## Roboto Flex

Copyright 2017 The Roboto Flex Project Authors (https://github.com/googlefonts/roboto-flex)

Licensed under the SIL Open Font License, Version 1.1. The font authors declare no Reserved Font Name. The full license text is served at `/fonts/OFL-roboto-flex.txt` (`public/fonts/OFL-roboto-flex.txt`).

Used only by the Material design of the /app PWA. The shipped files are a subset: Latin and Latin Extended only, with the weight axis (100 to 1000) and no other variation axes. Taken from the npm package `@fontsource-variable/roboto-flex` (version 5.3.0).
