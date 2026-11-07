# conradgelber.com

## Changelog

Whenever we ship a user-visible change, add a new entry to the top of `changelog.json` with the next version number before committing. The entry goes in the same commit as the change. Each entry has `version`, `date` (YYYY-MM-DD), a short `title` and 1 to 3 plain-English `bullets`.

Versions:

- Minor (v1.1.0): a new page, game or tool.
- Patch (v1.1.1): fixes and polish.
- Major (v2.0.0): a full redesign only.

Privacy rules (this file, the entries and the repo are all public):

- The limit for the private area is "Added a private personal area." Never describe how it, its sign-in or any authentication works.
- Describe security-related fixes only as "Maintenance and fixes."
- No secrets, keys, endpoints or internal file paths.

## The search list

After adding a changelog entry, or a page, game, essay or project, run `node scripts/build-site-index.mjs` and commit the result. It rebuilds the command palette's list and the date in the footer's changelog link, and `test/site-index.test.mjs` fails if they are stale. A new public page also needs `<script src="/js/site.js?v=N"></script>` after its stylesheet; add `data-app` to that tag if the page uses the keyboard. A new page that does real work on load, or a new private page, needs a line in `js/speculation-rules.json`.

## What the site serves

The deploy serves the repo root. `isBlockedPath` in `functions/_lib/paths.js` returns a 404 for docs, config and source that no page needs. If you add a top-level folder or config file that visitors don't need, add it there and to `test/blocked-paths.test.mjs`.
