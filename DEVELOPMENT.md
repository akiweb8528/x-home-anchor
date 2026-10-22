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
timeline or measure rendering timing. They cannot establish live-X compatibility
or resolve the image-position issue described in the README.

`build` bundles the content script and popup, then copies their HTML/CSS, the
manifest and `LICENSE` to `dist/`. It needs only this repository and its locked npm
dependencies. Load `dist/` as an unpacked Chrome extension. Keep dependencies and
generated output out of Git.

## Source responsibilities

| File | Responsibility |
| --- | --- |
| `src/adapter.ts` | X selectors, home/tab recognition, outer-post identity and interaction classification |
| `src/controller.ts` | Lifecycle, observers, user input and diagnostic commands |
| `src/position.ts` | Bounded position correction, recovery, approximation and interruption |
| `src/refresh-paint-guard.ts` | Refresh-only rendering checkpoint and cleanup |
| `src/refresh-total.ts` | Page-memory total of operated new-post controls' displayed counts |
| `src/observation.ts`, `src/model.ts` | Bounded diagnostic state, aggregates and message/report types |
| `src/content.ts` | Extension messages, singleton installation and page lifecycle |
| `src/popup.*` | Status, optional diagnostics and sanitized JSON download |

Keep X-specific assumptions in the adapter. A recognized timeline with unknown
post IDs remains distinct from an unrecognized region; quote IDs must never replace
outer-post IDs. After trusted recognized new-post activation, prefer exact restoration,
then one bounded downward approximation. Observed update evidence allows approximation
after a 650 ms recovery grace; an inconclusive update still allows count-based
fallback at three seconds when a displayed count and representative pitch are
available. A temporarily absent region may return within the original five-second
deadline, but no movement occurs while the region is unrecognized. Do not add an
estimate after exact restoration or move upward to an estimated target. User input,
explicit navigation and timeline changes override position correction. Do not replace page scroll
or History APIs or add request interception, API replay, automatic acquisition,
credential access or telemetry.

DOM instances, observed unique IDs, displayed-control totals and network acquisition
counts have different meanings. The extension does not measure network acquisition.
Diagnostics are opt-in, memory-only and separated by timeline: at most 5,000 IDs,
200 recent events and 30 minutes per session. Stop releases IDs; retained aggregates
expire after another 30 minutes. Do not add raw IDs, post content, authors, images,
credentials or response bodies to exports. The README owns the complete user-facing
retention description.

## Installation versions and maintenance

The manifest version identifies installation contents. If any `dist/` file changes,
advance the version (normally a patch increment) and align `package.json`, the
top-level lockfile version and `packages[""].version`. Rebuilding identical contents
or changing only documentation/tests does not require a version increment. Build
and inspect the generated manifest and file contents before delivery; version
updates are manual.

Preserve the MIT license and any required third-party notices when adding distributed
code or assets. X's DOM and labels are compatibility assumptions, not stable APIs.
Use synthetic data for tests and keep the known issue and live-site limitations in
the README accurate.
