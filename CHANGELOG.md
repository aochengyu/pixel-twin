# Changelog

All notable changes to pixel-twin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Work toward v1.0 — see [GitHub Milestone](https://github.com/aochengyu/pixel-twin/milestone/2).

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
