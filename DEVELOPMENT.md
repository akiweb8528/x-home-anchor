# Development

This Manifest V3 extension uses an isolated content script and an action popup.
There is no background worker, runtime package dependency or server. The manifest
matches only `https://x.com/*`; the controller activates the timeline features on
`/home`, including named custom tabs. Tab identity combines its header-tablist
position and label, so duplicate labels remain distinct. Repost-button holds work on identifiable posts independently of home/tab
recognition. Position preservation is always enabled, with no saved setting or API
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
including the manifest and license in `dist`. Synthetic DOM tests also exercise
hold timing boundaries, release/click ordering, cancellation, quote boundaries and
target replacement. They do not reproduce a full browser timeline or measure
rendering timing. They cannot establish live-X compatibility.

The [0.2.7 verification record](verification/0.2.7.json) records the integrated
unit/browser checks, scoped live-X mouse operations and ZIP byte/version checks.
Earlier individual-build evidence is retained separately.

The [refresh viewport verification record](verification/refresh-viewport.json) separates its synthetic
checks from the scoped live-X acquisitions. Raw live-page data stays outside the
repository. The [0.2.6 verification record](verification/0.2.6.json) describes the automated
checks, synthetic browser interaction evidence and unverified live-X scope.
The [0.2.5 browser verification record](verification/0.2.5.json) retains the earlier
timeline checks, popup inspection and transport stubs.

`npm run test:browser` builds and drives a dedicated headless Chrome through CDP
using trusted mouse/touch/keyboard input and the synthetic repost/refresh fixtures.
The window-blur cancellation case dispatches a synthetic event; touch input uses
Chrome emulation. These do not establish physical touch or live-X cancellation behavior.
Refresh checks cover per-frame post identity and position, canvas pixels, accidental-click
prevention, keyboard focus, root replacement, late page scroll, imprecise heights,
custom tabs, unread-boundary alignment (including tall posts) and cancellation.
Set `CHROME_BIN` to the Chrome executable if it is not `/opt/google/chrome/chrome`.
Every document response is synthetic; other requests are blocked. Extension
messaging is stubbed. The fixture's activity-menu link handles SPA routing; full
document navigations are not intercepted. Checks compare timeOrigin to detect
reloads. Evidence is written to ignored `verification/local/`, then the test closes
its browser and removes its temporary profile. This verifies neither native
extension installation nor the live X site's handlers or appearance.

`build` bundles the content script and popup, then copies their HTML/CSS, the
manifest and `LICENSE` to `dist/`. It needs only this repository and its locked npm
dependencies. Load `dist/` as an unpacked Chrome extension. Keep dependencies and
the generated `dist/` directory out of Git.

## Distributable ZIP

On Windows, macOS or Linux, run `npm ci` and then `npm run package`.
This uses PowerShell `Compress-Archive` on Windows and the system `zip` command
on macOS/Linux (install `zip` first if missing). No additional npm packages are needed.
The command builds `dist/` and creates `release/x-home-anchor-v<version>.zip`.
The ZIP contains the **contents** of `dist/` at its root, so `manifest.json`
is available immediately after extraction. It includes `LICENSE`, but no source
files or development dependencies. Unlike `dist/`, the versioned release ZIP
is committed to Git so users can install without Node.js.

When shipping a new extension version, update versions as described below,
regenerate the ZIP, and update the README download link. GitHub Releases may
also use the same ZIP as a manually attached release asset.

## Source responsibilities

| File | Responsibility |
| --- | --- |
| `src/adapter.ts` | X selectors, home/tab recognition, outer-post identity and interaction classification |
| `src/controller.ts` | Lifecycle, observers, user input and status |
| `src/position.ts` | Bounded position correction, recovery, approximation and interruption |
| `src/refresh-paint-guard.ts` | Refresh-only viewport copy, rendering checkpoint and cleanup |
| `src/refresh-total.ts` | Page-memory total of operated new-post controls' displayed counts |
| `src/repost-hold.ts` | Delegated repost-button hold, cancellation and matching release/click suppression |
| `src/quote-navigation.ts` | Bounded activation of X's own post-activity menu link and cancellation |
| `src/model.ts` | Timeline, DOM sample and position-preservation types |
| `src/content.ts` | Extension messages, singleton installation and page lifecycle |
| `src/popup.*` | Extension name and current position-preservation status |

The refresh guard copies the mounted timeline into a clipped fixed viewport outside
`body`, leaving X's virtualized cells and document geometry unchanged. Its clone is
inert and hidden from accessibility APIs; the outer surface consumes a press that
cancels it, preventing a stale displayed post from activating a different underlying
post. Videos and canvases use temporary canvas pixels when available. No copy is
persisted or transmitted. Preserve this copy when the timeline root is replaced;
remove it on input, navigation, resize, hiding or disposal. Real pointer input takes
priority over page-driven scroll changes, and the original five-second deadline never
extends. Normal completion waits
two animation frames for the destination range to mount before revealing it.

Keep X-specific assumptions in the adapter. A recognized timeline with unknown
post IDs remains distinct from an unrecognized region; quote IDs must never replace
outer-post IDs. After trusted recognized new-post activation, prefer exact restoration,
then one bounded downward approximation while retaining the original anchors until
the original deadline. Recovered IDs can correct the estimate without repeating it.
When the old first post below the refresh control is recovered, a uniquely
identified new post immediately before it becomes the reading anchor at the sticky
header's lower edge. Promote it only once; keep the old viewport cover until the
normal reveal and preserve all cancellation/deadline rules. Unknown adjacent posts
or previously known IDs must not be promoted. Promotion retires the old insertion
estimate, including when the new reading anchor already has zero displacement. The original known-ID set is temporary
and bounded by the same 500-post sample.
Observed update evidence allows approximation
after a 650 ms recovery grace; an inconclusive update still allows count-based
fallback at three seconds when document growth or a displayed count and representative pitch are
available. Use positive document growth from the original activation before count ×
old pitch; the virtualizer can replace the list with much shorter or taller posts.
Treat growth as an estimate until a saved ID returns. A temporarily absent region may return within the original five-second
deadline, but no movement occurs while the region is unrecognized. Exact restoration
covers the measured update, including page-driven scroll resets and subsequent virtualizer adjustments; a later insertion can still
need correction. Compare it with the restored geometry rather than permanently
disabling approximation after any successful correction. Keep count targets relative
to the original activation position, discard stale measured heights when a later
replacement cannot be measured, and never add the same insertion twice or move upward
to an estimated target. User input, explicit navigation and timeline changes override
position correction. Do not replace page scroll
or History APIs or add request interception, API replay, automatic acquisition,
credential access or telemetry.

The repost hold resolves the button's outer-post timestamp, including detail-view
footer metadata, through the adapter at
press start and again at 600 ms. It navigates immediately at the threshold, without
waiting for release or delaying short clicks. Cancel on movement beyond 10 CSS
pixels, leaving the button, scroll, pointer cancellation, target replacement,
navigation, hiding, window focus loss or disposal. Element blur when the repost
button gains focus does not cancel a hold. Keep one delegated listener set and at most one
pending gesture; do not tie it to a recognized home tab. Suppress only the completed
gesture's release/click and the tracked touch gesture's context menu, preserving
later gestures and ordinary keyboard, right- and middle-button actions. Before quote navigation the
controller interrupts position correction and its rendering guard. The hold reads
DOM URLs and requires no additional API calls or permissions. Navigation opens the
held post's own more menu and activates the exact matching quotes link. It waits
at most one second for asynchronous menu rendering and cancels on input, scroll,
pointer cancellation, window focus loss, navigation, hiding, target replacement or
disposal. Element blur and normal release do not cancel this wait; the completed
gesture still suppresses its matching release/click. A missing more button immediately falls
back to the resolved quotes URL; a missing or ineffective activity link falls back
at the one-second deadline. Revalidate the page and held target before fallback;
cancellation never triggers a reload. Browser checks compare timeOrigin; the
fixture no longer turns a hard navigation into a same-document transition.

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
