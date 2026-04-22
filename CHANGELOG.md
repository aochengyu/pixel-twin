# Changelog

All notable changes to pixel-twin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
| `0.x.y` | Pre-release — core mechanics implemented, threshold calibration and CI gate pending |
| `1.0.0` | Stable release — Build and Upgrade modes calibrated, pre-flight QA complete, CI gate enforced |
| `1.x.y` | Feature additions and polish on v1 |
| `2.0.0` | Interactive states, animations, form validation |
| `3.0.0` | Responsive/breakpoints, Storybook integration, multi-design-system |
