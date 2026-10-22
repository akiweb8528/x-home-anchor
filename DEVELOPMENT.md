# Development

This Manifest V3 extension uses an isolated content script and an action popup.
There is no background worker, runtime package dependency or server. The manifest
matches only `https://x.com/*`; the controller activates the timeline features on
`/home`. Position preservation is always enabled, with no saved setting or API
permissions. Installation and user operations are described in [README.md](README.md).

## Build and basic checks

Use Node.js 22.18 or newer and the dependencies in the lockfile:

```sh
npm ci
npm run check
npm run build
```

`check` runs TypeScript checking, small self-contained tests using synthetic data,
and the product build. The tests cover basic operations and the build contract,
including the manifest and license in `dist`. They do not reproduce a full browser
timeline or measure rendering timing. They cannot establish live-X compatibility.

The [0.2.5 browser verification record](verification/0.2.5.json) describes the
synthetic runtime checks, popup inspection, transport stubs and unverified scope.

`build` bundles the content script and popup, then copies their HTML/CSS, the
manifest and `LICENSE` to `dist/`. It needs only this repository and its locked npm
dependencies. Load `dist/` as an unpacked Chrome extension. Keep dependencies and
generated output out of Git.

## Source responsibilities

| File | Responsibility |
| --- | --- |
| `src/adapter.ts` | X selectors, home/tab recognition, outer-post identity and interaction classification |
| `src/controller.ts` | Lifecycle, observers, user input and status |
| `src/position.ts` | Bounded position correction, recovery, approximation and interruption |
| `src/refresh-paint-guard.ts` | Refresh-only rendering checkpoint and cleanup |
| `src/refresh-total.ts` | Page-memory total of operated new-post controls' displayed counts |
| `src/model.ts` | Timeline, DOM sample and position-preservation types |
| `src/content.ts` | Extension messages, singleton installation and page lifecycle |
| `src/popup.*` | Extension name and current position-preservation status |

Keep X-specific assumptions in the adapter. A recognized timeline with unknown
post IDs remains distinct from an unrecognized region; quote IDs must never replace
outer-post IDs. After trusted recognized new-post activation, prefer exact restoration,
then one bounded downward approximation. Observed update evidence allows approximation
after a 650 ms recovery grace; an inconclusive update still allows count-based
fallback at three seconds when a displayed count and representative pitch are
available. A temporarily absent region may return within the original five-second
deadline, but no movement occurs while the region is unrecognized. Exact restoration
covers the measured update, including a page top reset; a later insertion can still
need correction. Compare it with the restored geometry rather than permanently
disabling approximation after any successful correction. Keep count targets relative
to the original activation position, discard stale measured heights when a later
replacement cannot be measured, and never add the same insertion twice or move upward
to an estimated target. User input, explicit navigation and timeline changes override
position correction. Do not replace page scroll
or History APIs or add request interception, API replay, automatic acquisition,
credential access or telemetry.

Keep the DOM measurement limit at 500 outer-post elements, including boxes whose
post IDs are unavailable. Never use a partial over-limit sample for correction.
Position-preservation IDs, element references and measurements are bounded,
temporary page-memory state; the README owns the user-facing retention description.
The displayed-control total counts the numbers on operated new-post controls,
independently of correction success. It does not measure unique posts or network
acquisition. Both features run without opening the popup, which only requests status.

## Installation versions and maintenance

The manifest version identifies installation contents. If any `dist/` file changes,
advance the version (normally a patch increment) and align `package.json`, the
top-level lockfile version and `packages[""].version`. Rebuilding identical contents
or changing only documentation/tests does not require a version increment. Build
and inspect the generated manifest and file contents before delivery; version
updates are manual.

Preserve the MIT license and any required third-party notices when adding distributed
code or assets. X's DOM and labels are compatibility assumptions, not stable APIs.
Use synthetic data for tests and keep the live-site limitations in
the README accurate.
