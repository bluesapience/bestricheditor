# Contributing

Thanks for helping improve Best Rich Editor.

## Setup

```bash
npm ci
npm run dev      # Rollup watch + dev server at http://localhost:3000/demo/index.html
npm run build    # clean + production build (dist/)
npm test         # node --test tests/
npm run size     # size-limit budgets (run after build)
npm run bench    # jsdom benchmark; --write/--check baseline.json
```

Requires Node 18+ (CI uses Node 22).

## Ground rules

- Plain ES2020+ JavaScript with ES Modules. No TypeScript sources, no UI frameworks.
- Runtime dependencies are limited to DOMPurify and KaTeX.
- Everything public is namespaced: `bre.*` API, `.bre-*` CSS classes, `data-bre-*` attributes.
- Never assign `innerHTML` without DOMPurify. Sanitize every `href` / `src`. No `eval()`.
- The library ships structural CSS only: no colors, fonts or themes. Hosts style via `.bre-*` selectors.
- The JSON model is the source of truth; the DOM is a view.
- Keep `types/index.d.ts` in sync with public API changes.

## Pull requests

1. Branch from `main`.
2. Add or update tests and docs; add an entry under `Unreleased` in `CHANGELOG.md`.
3. Make sure `npm run build`, `npm test` and `npm run size` pass.
4. Fill in the PR template.

## Reporting bugs / requesting features

Use the issue templates. For security issues, do not open a public issue; contact the maintainers privately.

By contributing you agree that your contributions are licensed under the MIT License, and to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
