# Changelog

All notable changes to pixel-twin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

v2 full redesign in progress. See [`docs/pixel-twin-v2-design.md`](docs/pixel-twin-v2-design.md) for the approved spec.

Root causes addressed: fake orchestration, ad-hoc coverage, broken verify-fix loop, unreliable Figma→CSS mapping, no automatic triggering. v1.0.0-alpha architecture is superseded.

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
