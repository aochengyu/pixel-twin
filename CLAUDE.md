# datavant:ui-implement — Claude Context

This repo contains a Claude Code skill that automates the frontend UI implementation loop — from Figma design to pixel-accurate, code-quality-compliant implementation.

---

## What this repo is

A Claude Code skill (plugin) distributed internally at Datavant. It is **not** an application — it contains:

- `skills/` — Markdown skill files that Claude Code loads and executes
- `scripts/` — TypeScript utilities that the skill delegates computation to (screenshot, computed styles, pixelmatch diff)
- `docs/design-spec.md` — Full architecture specification

When in doubt about design decisions, read `docs/design-spec.md` first.

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

Then invoke: `/ui-implement <figma_url>`

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

## Roadmap

See `docs/design-spec.md` § 17 (Roadmap) for v2/v3 plans: interactive state verification, responsive breakpoints, animation token checking, multi-design-system support.
