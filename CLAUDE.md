# pixel-twin — Claude Context

This repo contains a Claude Code skill that automates the frontend UI implementation loop — from Figma design to pixel-accurate, code-quality-compliant implementation.

---

## What this repo is

A Claude Code skill (plugin) distributed internally at Datavant. It is **not** an application — it contains:

- `skills/pixel-twin.md` — Main orchestrator skill (v2)
- `skills/agents/` — Sub-agent skill files: `implementation-agent.md`, `visual-review-agent.md`, `code-review-agent.md`, `dart-knowledge.md`
- `scripts/` — TypeScript utilities: `computed-styles.ts` (batch mode), `css-variables.ts`, `bounding-boxes.ts`, `screenshot.ts`
- `docs/pixel-twin-v2-design.md` — Current architecture specification (v2)
- `docs/design-spec.md` — v1 architecture (superseded, kept for reference)
- `CHANGELOG.md` — Version history (Keep a Changelog format)

When in doubt about design decisions, read `docs/pixel-twin-v2-design.md` first.

---

## Skill file conventions

Skills are Markdown files with YAML frontmatter. They are instruction documents for Claude — not code. When modifying skill files:

- Write as if briefing a senior engineer who will execute the instructions
- Be precise and actionable. Vague instructions produce inconsistent behavior.
- Every step should be independently verifiable — if it cannot be verified, it should not be in the skill
- Prefer explicit over implicit. State assumptions, not just instructions.
- Never add UI flavor text to skill files — they are not UX; the UX is defined in the skill's output format

---

## Script conventions

Scripts in `scripts/` are TypeScript utilities run via `tsx`. They take arguments, produce structured JSON output to stdout, and exit cleanly. Rules:

- Scripts do computation only — no judgment calls (those belong in agent prompts)
- Scripts must be runnable standalone: `tsx scripts/screenshot.ts --url http://localhost:3000 --selector '[data-testid="foo"]'`
- All scripts accept `--help` and document their interface
- Output format is always JSON — callers parse it, not grep it
- Scripts are deterministic given the same inputs — no side effects except the intended output (screenshot file, stdout JSON)

---

## Testing the skill

There is no automated test suite for the skill itself (skills are tested by running them). For scripts:

```bash
npm run screenshot       # Test screenshot utility
npm run computed-styles  # Test computed styles extractor
npm run pixelmatch       # Test image diff utility
```

To do a real end-to-end test of the skill, open a Claude Code session in an app that has:
- A running dev server
- A Figma frame with a corresponding component

Then invoke: `/pixel-twin <figma_url>`

---

## Do not add

- Application code (routes, components, API clients)
- Dependencies beyond what the scripts need (pixelmatch, pngjs, playwright, tsx)
- CI/CD pipelines — distribution is manual install, not published npm package
- Test infrastructure for the skill prompts themselves — this is validated by running the skill on real designs

---

## Datavant-specific knowledge baked in

The skill's defaults are calibrated for Datavant projects — this is intentional. The design system is configurable (`designSystem` in the config); other Datavant conventions are hardcoded defaults that can be overridden as the skill matures:

- Design system: configurable, defaults to `@datavant/dart` for Datavant projects (the principle — enforce correct use of whatever design system the project uses — is universal)
- PHI + PII safety rules (HIPAA compliance — Datavant default)
- Codebase patterns: barrel exports, `.server.ts`, path aliases (`@client/*`, `@server/*`), React Router 7 loader/action pattern (Datavant defaults)
- MSW for fixture overrides, Playwright for screenshots and computed styles
- Zod for validation at system boundaries

---

## Key design decisions (survive compaction — read before editing skills)

- **Source of truth = Dart V1 tokens, not Figma.** Figma stale → `figmaConflict`, never FAIL.
- **Bounding-box rows are mandatory for ALL significant elements**, not just FILL-sized ones. Every layout bug produces a size deviation — this is the universal catch-all.
- **TEXT nodes always get `isOverflowingX` row** (expected: `"false"`) to catch truncation bugs.
- **Phase 6 is mandatory full verification**, not a spot-check. Implementation Agent must pass all Coverage Map rows before emitting result.
- **ITERATION > 1 requires root cause analysis first** — 7 categories defined in implementation-agent.md. No blind re-guessing.
- **Models**: Orchestrator = Sonnet, Implementation Agent = Opus 4.7, Visual Review = Sonnet, Code Review = Haiku→Sonnet.
- **Sequential sub-agents only** — never parallel. Parallel agents block each other on file writes.
- **File-based state (O(1) Orchestrator context)** — Orchestrator never accumulates cross-agent state in memory; reads from disk only. Compaction-safe by design.
- **Color normalization**: `transparent`/`currentColor`/`hsl()`/`oklch()` all have defined handling in visual-review-agent.md. `currentColor` → `needs-context`, never fail.
- **`childrenTestids` DOM metric** in computed-styles.ts returns direct children's testids in DOM order — used by structural rows to verify sibling order.

## V1 status (as of 2026-04-21)

Core mechanics, outside-in architecture, complete property matrix, root cause analysis loop, color normalization, and pre-flight interactive QA (Step 0c) are all implemented (see CHANGELOG [0.2.0]). Remaining before v1.0.0 stable:
- CI enforcement gate
- Real run threshold calibration (Issue #6)
- UX polish (Issue #7)

## Roadmap

See `docs/pixel-twin-v2-design.md` for current architecture. See GitHub issues for v3/v4 feature plans.
