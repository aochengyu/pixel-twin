# Changelog

All notable changes to pixel-twin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Pre-flight interactive QA (Step 0c)** — Orchestrator now asks four clarifying questions in a single message before building the Coverage Map: UI states, authentication, dynamic data/fixtures, and component exclusions. Answers are stored in `clarification.*` and drive interactive-state row generation, auth helper resolution, and exclusion filtering in Step 3.
- **Tip sheet for designers** — Step 0c prints best-practice guidance to minimize back-and-forth (Figma tokens vs. raw hex, per-state frames, realistic content dimensions, fixture setup).

### Changed

- **Step 3e — Complete mandatory property matrix** — Replaced the previous ad-hoc property list with a systematic matrix by element type. Every element type now has a mandatory minimum set: layout containers get `display`/`flex-*`/`overflow`/`padding`/`background`/`border` + `boundingWidth`/`boundingHeight`; text nodes get full typography set + `isOverflowingX`/`white-space`/`text-overflow`/`letter-spacing`; dart/Mantine instance roots get bg/border/`boundingWidth`/`boundingHeight`; SVGs get size + color/fill. Added `margin`, `align-self`, `flex-basis`, `box-shadow`, `opacity`, `position` as conditional properties.
- **Phase 6 — Mandatory full self-verify** — Implementation Agent must now run `computed-styles.ts` against **all** Coverage Map rows for the component (not a spot-check) and fix any failures before emitting the result file.
- **ITERATION > 1 — Mandatory root cause analysis** — Implementation Agent must classify every failure into one of 7 root cause categories (wrong CSS variable, wrong dart prop, selector mismatch, layout cascade, missing property, Mantine internal override, CSS specificity conflict) before writing any code.
- **Step 4b — Structural row sibling order check** — Visual Review Agent now verifies sibling order via `childrenTestids` DOM metric in addition to selector existence. Order mismatch → `status: "fail"`.
- **Visual Review Agent — Color normalization pipeline** — Added handling for `transparent`, `currentColor`, `hsl()`, `oklch()`/`lab()`/`lch()`, `rgba(..., 1)`, and hex with alpha. `currentColor` → `needs-context` (never fail). `transparent` → compare with `alpha-0.01` logic.
- **`exact-string` tolerance key** — Added for string-typed CSS properties (display, flex-direction, overflow, white-space, text-overflow, position, etc.).
- **`plus-minus-2px` clarification** — Applies to `boundingWidth`/`boundingHeight` for ALL significant elements, not just fill-container instances.
- **Model upgrade** — Implementation Agent upgraded from `claude-opus-4-6` to `claude-opus-4-7`.
- **Adopt Mode Step 2a-2** — Now explicitly references the complete property matrix from Step 3e.
- **`computed-styles.ts`** — Added `childrenTestids` DOM metric: returns JSON-stringified array of direct children's `data-testid` values in DOM order (elements without testid appear as `tagname:position`). Available in both batch and single mode.
- **`CLAUDE.md`** — Added "Key design decisions" section with all critical architecture decisions that survive context compaction.

---

## [1.0.0-alpha] - 2026-04-10

---

## [1.0.0-alpha] - 2026-04-10

First complete implementation. All four agents implemented and wired together. Needs calibration on a real run before v1.0.0 stable.

### Added

- **Orchestrator** (`skills/pixel-twin.md`) — full 7-step loop: config loading, dev server check, Jira context, Figma frame reading, Build/Upgrade mode detection, component loop, full-page integration pass, sign-off
- **Implementation Agent** (`skills/agents/implementation-agent.md`) — 6-phase workflow: understand design, understand codebase, plan, write code, generate Content Density Fixture, output ReviewSpec
- **Visual Review Agent** (`skills/agents/visual-review-agent.md`) — Track A (computed styles via Playwright, Figma value comparison, three-category classification) + Track B (screenshot diff via pixelmatch + Claude Vision)
- **Code Review Agent** (`skills/agents/code-review-agent.md`) — Phase 1 parallel tool runs + Phase 2 semantic analysis with configurable safety/convention profiles
- **Scripts**: `screenshot.ts`, `computed-styles.ts`, `pixelmatch-compare.ts`, shared `_args.ts`
- `.npmrc` pointing to public npm registry (pixel-twin uses only public packages)
- `tsconfig.json`

### Architecture

- Autonomous by default — only surfaces to human for low-confidence marginals or genuine stuck state
- Stuck escalation ladder: retry → re-read Figma → different approach → Opus → human
- Models: Haiku (routing/Phase 1), Sonnet (implementation/semantic review/visual review), Opus (escalation only)
- Safety and convention checks are configurable profiles (`datavant-hipaa`, `basic`, `none`)

---

## [0.1.0] - 2026-04-10

### Added

- Full architecture design spec (`docs/design-spec.md`):
  - Two modes: Build Mode (new UI from scratch) and Upgrade Mode (targeted delta fixes)
  - Three-agent architecture: Orchestrator + Implementation Agent + parallel Visual/Code Review agents
  - Two-track visual verification: computed styles (primary) + pixelmatch screenshot (secondary)
  - Three diff categories: Structural (block) / Marginal (engineer decides) / Rendering Delta (document)
  - Content Density Fixture strategy for data-independent visual testing
  - Checkpoint UX design with marginal item triage
  - Final sign-off format with side-by-side comparison
  - Model assignments: Haiku (routing), Sonnet (implementation/semantic review), Opus (escalation)
  - v2/v3 roadmap: interactive states, animations, responsive verification, multi-design-system
- Skill placeholder (`skills/pixel-twin.md`) with full structural documentation
- Script utilities scaffold: `screenshot.ts`, `computed-styles.ts`, `pixelmatch-compare.ts`
- `CLAUDE.md` with skill and script development conventions
- `README.md` with usage, configuration, and roadmap table

---

## Versioning Strategy

| Version range | Meaning |
|---------------|---------|
| `0.x.y` | Pre-release — design and scaffolding phase |
| `1.0.0` | First working implementation — Build and Upgrade modes functional, thresholds calibrated |
| `1.x.y` | Bug fixes and polish on v1 feature set |
| `2.0.0` | Interactive states, animations, form validation states |
| `2.x.y` | Bug fixes and polish on v2 feature set |
| `3.0.0` | Responsive/breakpoints, Storybook integration, richer design system support |
