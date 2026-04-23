# Changelog

All notable changes to pixel-twin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-04-23

Closes remaining systemic gaps: selector re-validation on every VRA run, JSX-first selector assignment in Upgrade/Adopt Mode, and token migration property existence rule.

### Added

- **Step 5a — selector re-validation before every VRA dispatch** (`skills/pixel-twin.md`) — `validate-coverage-map.ts` now runs at the start of Step 5a on every run, not just at Coverage Map creation. Code changes between Coverage Map creation and the next VRA run can make selectors stale; catching them here prevents wasted VRA iterations that measure `null`.
- **Step 3g — JSX-first selector assignment in Upgrade/Adopt Mode** (`skills/pixel-twin.md`) — in Upgrade and Adopt Mode, selectors must be derived from reading the actual source JSX, not guessed from Figma layer names. For each significant container, a Figma node → JSX element → CSS selector mapping must be stated before the selector is written to the Coverage Map. This is the root cause fix for the "outer `<span>` vs `<strong>` children" class of mistakes.
- **Phase 5 — CSS property existence rule** (`skills/agents/implementation-agent.md`) — before writing or keeping any CSS property (especially during token migrations), the agent must verify the property itself exists in Figma. "It was there before" is not a valid reason to keep a property. This closes the gap where `padding-bottom: 1.5rem` → `var(--mantine-spacing-md)` migration preserved a property that Figma never specified.

---

## [0.6.0] - 2026-04-23

Systematic prevention of low-level mistakes: selector validation, data requirements, DOM mapping enforcement, and pseudo-element handling.

### Added

- **`validate-coverage-map.ts`** — new script that dry-runs every CSS selector in a Coverage Map against the live DOM before VRA runs. Reports `✅ found / ⚠️ multiple / ❌ not-found` for each selector. `--update` flag marks not-found rows as `needs-verify` in the map. Exits 1 if any selector returns 0 elements. Eliminates the class of bugs where stale selectors reach VRA and produce null measurements.
- **Step 3h-validate — mandatory selector dry-run after Coverage Map is written** (`skills/pixel-twin.md`) — orchestrator must run `validate-coverage-map.ts` after writing the Coverage Map and before proceeding to 3i. No `❌` rows allowed before moving on.
- **`prerequisites.dataRequirements` field (required)** (`skills/pixel-twin.md`) — Coverage Map `prerequisites` must now include `dataRequirements`: a description of exactly what data state the URL must be in for all components to render correctly (e.g. "Use request 8252 — exception request required for exception badge to appear"). Prevents wrong-URL measurements that silently measure the wrong UI state.
- **Phase 3a — Figma node → DOM element mapping table** (`skills/agents/implementation-agent.md`) — after reading the source file, agent must produce an explicit table mapping each Figma node to its exact JSX element and DOM selector, including sub-element notes (e.g. `<strong>` children vs outer `<span>`). This table is required before any fix is written. Prevents the class of bugs where the wrong DOM element is targeted.
- **Pseudo-element detection rule in Step 3e** (`skills/pixel-twin.md`) — when `get_design_context` shows `::after`/`::before` for visual effects, Coverage Map rows must target the parent's measurable properties (`position`, `z-index`, `border-bottom: none`) instead of the pseudo-element. Prevents `expected: "1.5px"` on a property that will always measure `0px`.

---

## [0.5.0] - 2026-04-23

Process hardening: mandatory Figma re-verification before every CSS fix, Gate 8, and `--headed` flag for computed-styles.

### Added

- **Gate 8 — Figma citation block required before any CSS write** (`skills/pixel-twin.md`) — Every proposed fix must be accompanied by a printed citation block (`figma nodeId / figma says / DOM measured / fix`) before any code is written. If the block cannot be produced, the fix is blocked and the row is set to `needs-verify`. This makes Gate 6 violations visible to the engineer rather than silent.
- **Step 5d — mandatory Figma re-verification before dispatching Implementation Agent** (`skills/pixel-twin.md`) — When VRA reports failures, the orchestrator must now call `get_design_context` on each failing row's `figmaNodeId` and print a citation block before looping back. If Figma returns a value that differs from Coverage Map `expected`, the map is corrected before dispatch — preventing the agent from fixing toward the wrong target.
- **Implementation Agent Phase 1 Step 0 — `get_design_context` for every FAIL row** (`skills/agents/implementation-agent.md`) — On ITERATION > 1, before root cause analysis, the agent must call `get_design_context` for each FAIL row and explicitly state "Figma says X / map expected Y." If they differ, the Figma value is the target. "The Coverage Map says X" is not a valid CSS justification.
- **`--headed` flag for `computed-styles.ts`** — Runs Playwright in headed (non-headless) mode for interactions that require trusted user gestures (e.g. DateInput calendar).

### Fixed

- **`computed-styles.ts` `--batch` argument parsing** — `--batch` was incorrectly treated as a boolean flag; corrected to accept a file path string.

---

## [0.4.0] - 2026-04-22

Bug fixes: IA/VRA ownership boundary, Mantine v8 tab selector correctness, and `--wait-for` timing clarification.

### Fixed

- **IA must not update Coverage Map `status`/`actual` (critical)** — Implementation Agent Phase 6 previously said to record self-verified rows "so the Visual Review Agent can skip them if unchanged." This caused IA to write `"status": "pass"` in the Coverage Map, making VRA a no-op on re-runs. Phase 6 now says "for diagnostic purposes only." Phase 7 adds a hard rule: IA must never update Coverage Map `status` or `actual` — those fields are exclusively managed by VRA.
- **Mantine v8 `[data-value]` warning in dart-knowledge.md** — `Tabs.Tab` buttons in Mantine v8 do NOT render a `[data-value]` attribute. Added an explicit warning to the Tabs section and updated the `setupInteractions` example to avoid this selector.
- **`keepMounted` gotcha in dart-knowledge.md** — Documents that all Mantine tab panels remain in the DOM by default (`keepMounted={true}`). `waitFor: "[data-testid='content']"` can match a hidden panel from another tab. Added guidance to use `[data-state='active']` or a bounding-box check.
- **`--wait-for` runs AFTER `--interactions` (VRA Step 2)** — Clarified in `visual-review-agent.md` that `--wait-for` fires only after all interactions complete. Documented the pattern: add `{ "action": "waitFor", "selector": "<initial-element>" }` as the first entry in `setupInteractions` to guarantee page readiness before the first click.

---

## [0.3.0] - 2026-04-22

Gap closure: Figma-first Coverage Map building, screenshot comparison, SVG/image color verification, and VRA interactive state format.

### Added

- **`imagePixelColor` DOM metric (`computed-styles.ts`)** — Canvas-based center-pixel sampling for `<img>` elements. Returns `rgb(R, G, B)` on success, `"cross-origin"` when CORS blocks canvas read, `"not-an-img"` for non-image elements, `"not-loaded"` if image hasn't completed loading. Closes the image-asset color verification blind spot.
- **VRA Step 4c — Screenshot comparison** — After CSS property verification, VRA now takes a browser screenshot of the component and compares it against the stored Figma screenshot using `pixelmatch-compare.ts`. Thresholds: `≤ 1%` → pass, `1–5%` → warn (human review), `> 5%` → fail. Catches visual regressions that CSS properties alone cannot detect (icon shape, SVG path variants, rendering artifacts).
- **Gate 7** — Orchestrator must call `get_screenshot` on every significant container during Phase 1 of Step 3d-containers. Paths stored in `prerequisites.figmaScreenshots` in the Coverage Map.

### Changed

- **Step 3d-containers — Figma-first two-phase structure** — Enforces separation between Figma data collection (Phase 1) and Coverage Map row writing (Phase 2). Phase 1 writes all `get_design_context` + `get_screenshot` results to `figma-data-<frameId>.json` before any rows are written. Phase 2 reads only from that file when setting `expected` values. Eliminates cognitive bias where expected values were derived from code knowledge rather than Figma data.
- **Gate 6** — `expected` values must be traceable to `get_design_context` output. Every Coverage Map row must carry a `figmaSource` annotation (e.g. `"get_design_context nodeId 40:12458"`). Writing expected values from code knowledge, screenshots, or "looks correct visually" reasoning is prohibited.
- **VRA interactive state grouping** — Replaced `verificationMethod: "interactive"` split with per-row `state` + `setupInteractions` fields. Each distinct `state` value runs its own browser pass with its own interaction sequence. `prerequisites.setupInteractions` is no longer used for per-row measurement.
- **dart-knowledge.md — Tabler icon color measurement** — Documents that the React `color` prop sets CSS `stroke` (not `color`) on the SVG root. `getComputedStyle(svg).color` reads inherited page color and is wrong. Correct metric is `stroke`. Also documents `imagePixelColor` usage for `<img>`-rendered icon assets.

---

## [0.2.0] - 2026-04-21

Coverage Map architecture redesign, quality improvements, and dart auto-detection.

### Added

- **Pre-flight interactive QA (Step 0c)** — Orchestrator now asks four clarifying questions in a single message before building the Coverage Map: UI states, authentication, dynamic data/fixtures, and component exclusions. Answers are stored in `clarification.*` and drive interactive-state row generation, auth helper resolution, and exclusion filtering in Step 3.
- **Tip sheet for designers** — Step 0c prints best-practice guidance to minimize back-and-forth (Figma tokens vs. raw hex, per-state frames, realistic content dimensions, fixture setup).
- **Dart component auto-detection (Step 3b-dart)** — Orchestrator automatically classifies Figma nodes as dart/Mantine instances based on component name patterns. Dart instances use the instance-root property matrix and never get CSS overrides on internals.

### Changed

- **Coverage Map architecture** — Complete redesign from ad-hoc checklist to file-based Coverage Map (`coverage-map-<frameId>.json`). Orchestrator context stays O(1); all state written to disk. Enables mid-run resumption and regression checks across frames.
- **Sequential sub-agents only** — Implementation Agent → Visual Review Agent → Code Review Agent run sequentially per component. Never parallel.
- **`computed-styles.ts` — batch mode** — Opens browser once, runs all selector checks in a single session. Eliminates per-selector browser launches.
- **`css-variables.ts`** — New script to resolve Dart V1 CSS token values from the running app. Used by Coverage Map Builder for three-way Figma/DartV1/actual comparison.
- **Step 3e — Complete mandatory property matrix** — Replaced ad-hoc property list with a systematic matrix by element type: layout containers, text nodes, dart/Mantine instance roots, SVG/icons — each with a mandatory minimum set including `boundingWidth`/`boundingHeight`.
- **Phase 6 — Mandatory full self-verify** — Implementation Agent must run `computed-styles.ts` against all Coverage Map rows for the component and fix any failures before emitting the result file.
- **ITERATION > 1 — Mandatory root cause analysis** — Implementation Agent classifies every failure into one of 7 root cause categories before writing any code.
- **Step 4b — Structural row sibling order check** — Visual Review Agent verifies sibling order via `childrenTestids` DOM metric. Order mismatch → `status: "fail"`.
- **Visual Review Agent — Color normalization pipeline** — Handles `transparent`, `currentColor`, `hsl()`, `oklch()`/`lab()`/`lch()`, `rgba(..., 1)`, and hex with alpha. `currentColor` → `needs-context` (never fail).
- **`exact-string` tolerance key** — For string-typed CSS properties (display, flex-direction, overflow, white-space, text-overflow, position, etc.).
- **`plus-minus-2px`** — Applies to `boundingWidth`/`boundingHeight` for all significant elements.
- **Model upgrade** — Implementation Agent upgraded from `claude-opus-4-6` to `claude-opus-4-7`.
- **`computed-styles.ts` — `childrenTestids` DOM metric** — Returns JSON-stringified array of direct children's `data-testid` values in DOM order.
- **`CLAUDE.md`** — Added "Key design decisions" section with architecture decisions that survive context compaction.

---

## [0.1.0] - 2026-04-10

First complete implementation. All four agents implemented and wired together.

### Added

- **Orchestrator** (`skills/pixel-twin.md`) — full loop: config loading, dev server check, Figma frame reading, Build/Upgrade mode detection, component loop, full-page integration pass, sign-off
- **Implementation Agent** (`skills/agents/implementation-agent.md`) — 6-phase workflow: understand design, understand codebase, plan, write code, generate Content Density Fixture, output ReviewSpec
- **Visual Review Agent** (`skills/agents/visual-review-agent.md`) — Track A (computed styles via Playwright, Figma value comparison, three-category classification) + Track B (screenshot diff via pixelmatch + Claude Vision)
- **Code Review Agent** (`skills/agents/code-review-agent.md`) — Phase 1 parallel tool runs + Phase 2 semantic analysis with configurable safety/convention profiles
- **Scripts**: `screenshot.ts`, `computed-styles.ts`, `pixelmatch-compare.ts`, shared `_args.ts`
- `.npmrc` pointing to public npm registry
- `tsconfig.json`

### Architecture

- Autonomous by default — only surfaces to human for low-confidence marginals or genuine stuck state
- Stuck escalation ladder: retry → re-read Figma → different approach → Opus → human
- Models: Haiku (routing/Phase 1), Sonnet (implementation/semantic review/visual review), Opus (escalation only)
- Safety and convention checks configurable via `safetyProfile` and `conventionProfile`

---

## Versioning Strategy

| Version range | Meaning |
|---------------|---------|
| `0.x.y` | Pre-release — mechanics are implemented but known bugs may still exist; no stability guarantee |
| `1.0.0` | First stable release — all known bugs closed, real-project run completed, thresholds calibrated, CI gate enforced |
| `1.x.y` | Incremental additions on the stable base (new property types, new dart component entries, convenience improvements) |

**Feature gate** — Interactive states, animations, responsive/breakpoints, and Storybook integration will be planned only after `1.0.0` is released. Adding features to a pre-release product that still has unfixed bugs compounds instability. Each feature category will be scoped as a separate minor version (`1.1.0`, `1.2.0`, etc.) once the core is stable, not as major version bumps.
