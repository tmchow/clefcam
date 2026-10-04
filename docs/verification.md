# Verification

## Current coverage

The Flash-only app was checked with Node 24.17.0, npm 11.13.0, Google Chrome and Playwright's matching WebKit runtime.

| Check                                          | Result          |
| ---------------------------------------------- | --------------- |
| ESLint and TypeScript                          | Passed          |
| Vitest                                         | 41 tests passed |
| Chrome browser suite                           | 35 tests passed |
| Focused Chrome/WebKit touch and keyboard suite | 14 tests passed |
| Focused Chrome/WebKit camera-pixel suite       | 2 tests passed  |
| Production Worker/client build                 | Passed          |

Browser tests use synthetic camera streams and intercepted inference responses. They do not call hosted inference. Test screenshots and traces are generated locally under ignored directories and are not distributed with the source.

## What the tests establish

- **Rules and touch:** add three custom rules without closing the picker, immediately reveal each row, edit/save, remove, switch categories, retain presets, enforce the six-rule limit, and explicitly resolve gesture conflicts. Custom rows remain available across categories.
- **Keyboard:** actual touch focus, viewport height and offset changes, compact portrait/landscape editors, and draft retention across Back, Close and reopening. Edits apply only through Save.
- **Camera pixels:** independently decoded inference/capture JPEGs and rendered preview pixels agree on centered crop and front mirroring across camera switches, sensor rotation, viewport resize and resume.
- **Evaluation:** no network calls with zero enabled rules; visibility and user-intent guards on resume; delayed camera permission; stale and failed replies; safe diagnostic codes; incomplete replies; and one-shot Auto saving the evaluated frame even when the live scene changes before its response.
- **Security:** signed JWT acceptance/rejection, exact host/email/issuer/audience, expiration and maximum token lifetime, anonymous asset/API denial, origin validation, inference-disabled mode, streamed body caps, image validation and rule payload limits.
- **Usage:** concurrent reservations fail closed, failures retain reservations, historical accounting remains valid, and missing/malformed usage is represented as unknown. Cost and latency calculations exclude inappropriate replies without erasing incurred usage.

The custom-row regression failed before its repair in both Chrome and WebKit. Error/stale-response regressions and temporary-copy mutations of authorization, payload and budget guards also failed for the intended reasons before the corresponding repair or restoration.

## Visual and asset checks

Reviewed mobile portrait/landscape focused editors, the open custom picker, front/rear camera layouts and captured-frame renders. Inspected the camera/C icon at full size and 60px, and the README illustration at mobile width on light and dark backgrounds.

Apple touch (180px), manifest (192/512px) and favicon (32px) PNGs have the documented dimensions and opaque backgrounds. The SVG, PNG and manifest files are included in production output; local serving returns their expected MIME types. No service worker or offline mode is installed.

## Reproduce

Follow the [README check commands](../README.md#check-your-changes). Run browser suites sequentially so one test process cannot stop a shared server underneath another. The suites start Vite themselves. A clean checkout can install and build without private deployment configuration; missing authorization settings fail closed.

A Docker-daemon probe warning may appear during the Cloudflare build. This Worker has no containers; confirm the command exits successfully and emits both Worker and client output.

## What still needs hardware or deployment verification

Synthetic streams and desktop WebKit do not establish real iPhone camera permission, lens selection, software-keyboard/safe-area behavior, image downloading, model reliability under real lighting, or home-screen icon caching and standalone sign-in.

After deploying on your own account, verify anonymous HTML, exact new JavaScript, API, icons and manifest are blocked by Access. Then sign in on a phone and test the real camera and inference route. Keep icons protected; do not add an anonymous bypass to make home-screen fetching work.

A generic check failure does not identify its cause. Use **Details → Show diagnostics** for safe status/error codes and camera geometry, then reproduce with the actual device. Passing mocks do not establish a production inference fix. No private deployment identifiers, owner authentication details, camera photos or historical usage receipts are included in this public verification summary.

## Matching feedback

- Rule outcomes use stable tiles with visible icons and state labels, a high-contrast summary, and a subdued Add rule action. Six outcomes fit the tested portrait and landscape layouts. A restrained inset viewfinder glow shares the matched-rule green and appears only for a fresh, complete all-enabled-rule observation. It fades on nonmatch, error, expiry or invalidation; repeated identical results do not pulse it. Reduced motion disables the feedback animation.
- The UI distinguishes the last checked frame from a pending new sample. Expired evidence waits for a fresh result instead of reporting zero matches; incomplete replies cannot create whole-scene success. Auto identifies its first matching observation and then the evaluated-frame capture. Manual capture remains independent of rules. Cadence, image encoding, model prompts, security and budget accounting are unchanged.
- The requested simplification, focused test audit and full code review completed. The audit strengthened stale-frame timing and response-processing barriers. Review found one long-custom-label layout shift; a reserved two-line announcement region fixed it while retaining full assistive text. Browser reproduction and a regression verified the repair.
- Physical iPhone camera, Safari software keyboard, screen-reader announcements and authenticated production inference still require device/owner verification. Mocked browser responses and synthetic streams do not establish those claims. No inference calls were needed for this change.
- Final checks passed: lint, TypeScript, production build, 41 unit/security tests, 42 Chrome browser tests, 14 Chrome/WebKit touch-keyboard checks and two Chrome/WebKit camera-pixel checks. Reviewed bright/dark portrait and landscape screenshots, reduced motion, and focused-input WebKit layouts. The non-container build completed despite the existing Docker probe warning.

## Rounded match glow

- The fresh all-match frame has a stronger stroke and soft inner/outer glow, rounded corners, and a minimum inset that respects each viewport safe area without adding it twice. Landscape controls also respect side safe areas so the frame stays clear of their text. The camera canvas and capture geometry remain unchanged.
- Ran the requested simplification, focused test audit and local code review. The audit consolidated redundant background cases and added control-clearance assertions. Review found no actionable issues. The geometry regression failed against the previous 2px inset; an isolated variant with old control spacing also failed the new landscape bounds check.
- Checked bright/dark portrait and landscape renders, simulated browser/standalone safe areas, focused-input WebKit layouts, touch capture, reduced motion and existing match lifecycle behavior. Physical iPhone Safari clipping, browser chrome and standalone rendering still require device confirmation. No inference calls or security/budget changes were needed.
- Final checks passed: lint, TypeScript, production build, 41 unit/security tests, 45 Chrome browser tests, 14 Chrome/WebKit touch-keyboard checks and two Chrome/WebKit camera-pixel checks. The existing Docker probe warning does not block this non-container build.

## Personal-demo usage limits

- Removed the 120-check page/session interruption and raised the shared daily allowance from 300 to 1,000 reservation units. The 2,000-unit lifetime ceiling, historical weighted/session counters, failed-call reservations and unknown-usage accounting remain intact. Rate and concurrent-call protection are unchanged. No inference calls or counter resets were used for this change.
- Daily, lifetime, concurrent-check and rate failures now carry separate safe codes and recovery messages. Daily allowance returns at 00:00 UTC; lifetime exhaustion requires explicit owner budget review. Reloading restores neither allowance. The full reason appears in Details and Cost & speed as well as the compact camera status.
- Ran simplification, focused test audit and full local code review. The audit strengthened completed-request proof beyond 120 attempts, actual touch edits, paused scheduling, server rejection codes, exact admission boundaries and midnight behavior. Old-code regressions fail at the former page/session limits and missing reason codes. The reported production trigger remains unconfirmed: historical request logging is disabled and authenticated usage requires owner sign-in.
- Final validation passed: lint, TypeScript, production build, 43 unit/security tests, 51 Chrome browser tests (50-suite plus the long-session regression), 14 Chrome/WebKit touch-keyboard tests and two Chrome/WebKit camera-pixel tests. Reviewed mobile portrait/landscape recovery messages. Browser mocks do not establish the owner's production usage or physical iPhone behavior. The non-container build completed despite the existing Docker probe warning.
