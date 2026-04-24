# pixel-twin — Claude Context

This repo contains a Claude Code skill that automates the frontend UI implementation loop — from Figma design to pixel-accurate, code-quality-compliant implementation.

---

## What this repo is

A Claude Code skill (plugin) distributed internally at Datavant. It is **not** an application — it contains:

- `skills/pixel-twin.md` — Main orchestrator skill (v2)
- `skills/agents/` — Sub-agent skill files: `implementation-agent.md`, `visual-review-agent.md`, `code-review-agent.md`, `dart-knowledge.md`
- `scripts/` — TypeScript utilities: `computed-styles.ts` (batch mode), `validate-coverage-map.ts` (selector dry-run), `css-variables.ts`, `pixelmatch-compare.ts`, `bounding-boxes.ts`, `screenshot.ts`
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

### Architecture & agent behavior

- **Sequential sub-agents only** — never parallel. Parallel agents block each other on file writes.
- **File-based state (O(1) Orchestrator context)** — Orchestrator never accumulates cross-agent state in memory; reads from disk only. Compaction-safe by design.
- **Models**: Orchestrator = Sonnet, Implementation Agent = Opus 4.7, Visual Review = Sonnet, Code Review = Haiku→Sonnet.
- **Phase 6 is mandatory full verification**, not a spot-check. Implementation Agent must pass all Coverage Map rows before emitting result.
- **ITERATION > 1 requires root cause analysis first** — 7 categories defined in implementation-agent.md. No blind re-guessing.
- **Bounding-box rows are mandatory for ALL significant elements**, not just FILL-sized ones. Every layout bug produces a size deviation — this is the universal catch-all.
- **TEXT nodes always get `isOverflowingX` row** (expected: `"false"`) to catch truncation bugs.
- **Color normalization**: `transparent`/`currentColor`/`hsl()`/`oklch()` all have defined handling in visual-review-agent.md. `currentColor` → `needs-context`, never fail.
- **`childrenTestids` DOM metric** in computed-styles.ts returns direct children's testids in DOM order — used by structural rows to verify sibling order.
- **Real-time progress updates** — print progress after every 10–12 row batch when running VRA or computed-styles batch jobs. Never show only the final 100%.

### Figma & data integrity

- **Source of truth = Dart V1 tokens, not Figma.** When `css-variables.ts` shows a token resolves differently from the Figma fallback → `figmaConflict: true`. This is a measurement-based decision only — never declared unilaterally (see process rules below).
- **Figma token name exact match** — when `get_design_context` returns `var(--token-name, fallback)`, run `css-variables.ts --vars "token-name"` on the EXACT token name from Figma. If it returns empty string, the fallback IS the correct value. NEVER substitute a differently-named token from another system (`--Spacing-spacing-xl ≠ --mantine-spacing-xl` — separate token systems with different values).
- **Coverage Map `actual` must come from DOM measurement only** — never set `actual` manually, never copy from `expected`. If computed-styles.ts has not been run for a row, leave `actual: null, status: "pending"`. A wrong `actual` produces a silently wrong `pass` status.
- **Always include hex fallback in `var(--token, #hex)`** — missing fallbacks silently produce wrong values when the token is undefined. The hex comes from Figma's `get_design_context` output.

### Implementation rules

- **Gate 8 (Figma citation block)** — every CSS fix must print `figma nodeId / figma says / DOM measured / fix` before any code is written. No citation = no fix. Defined in pixel-twin.md MANDATORY GATES.
- **CSS property existence rule (Phase 5)** — before writing or keeping any CSS property (especially in token migrations), verify the property exists in Figma. "It was there before" is not a valid reason.
- **JSX-first selector assignment (Step 3g, Upgrade/Adopt Mode)** — selectors must be derived from reading actual JSX, not guessed from Figma names. A Figma node → JSX element → selector mapping must be stated before the selector is written to the Coverage Map.
- **`validate-coverage-map.ts` runs before every VRA dispatch (Step 5a)** — stale selectors produce null measurements; catching them here prevents wasted VRA iterations.
- **No Figma content in code files** — never put Figma node IDs, Figma URLs, raw Figma values, or `Figma: …` comments in `.tsx`/`.ts`/`.css` files. All Figma metadata belongs in the Coverage Map JSON only.
- **Verify Figma text content, not just structure/CSS** — after `get_design_context`, diff every text string it returns against the code's messages/constants. String mismatches (labels, placeholders, headings) are bugs just like wrong colors.
- **Verify icon name from Figma component description** — never assume an icon name. Read the component description in the `get_design_context` response. `IconCheck ≠ IconCircleCheck`.

### Process & workflow

- **Call `get_design_context` before any CSS/style fix** — before touching any color, spacing, font, or structural CSS property, call `get_design_context` on the relevant Figma node. Never source `expected` values from current code or DevTools readings (this is Gate 6).
- **VRA failure protocol — re-verify Figma before fixing code** — when VRA reports a mismatch: (1) re-read JSX to confirm selector hits the right element; (2) call `get_design_context` to re-verify Figma's intent; (3) only then write a fix. Never fix code to match your own Coverage Map `expected` without re-verifying Figma first.
- **Never declare Figma stale without user approval** — Figma is the implementation authority. If dart renders differently from Figma, find the correct dart prop or ask the engineer. Never flip `figmaConflict: true` unilaterally.
- **Grep all string consumers before committing** — when changing any user-visible string (placeholder, label, column header), run `grep -r "old string" e2e/ client/` to find every E2E test, page object, and unit test that references it. Changing a string without updating all its consumers breaks E2E tests silently.
- **E2E tests must pass before any task is complete** — after any code change, grep all E2E spec files and page objects for strings that changed; for logic changes run unit tests. Do not report a task complete if tests are broken.
- **Playwright ≠ final visual verification** — Playwright runs Chromium; the user may be on Safari. Never declare a CSS fix done based on Playwright screenshots alone — always get user confirmation in their actual browser.
- **CSS scientific method — hypothesis proven by measurement before any code** — five steps: (1) observe the symptom; (2) list possible root causes; (3) form a falsifiable hypothesis; (4) measure to prove it; (5) write the fix. No proven hypothesis = no code written.
- **CSS retry protocol — state why fix N failed before attempting fix N+1** — if you cannot explain in one sentence why the previous fix failed, stop and measure more. "Trying a different value" is not a diagnosis.
- **User statements are ground truth** — enforce exactly what the user states. When uncertain, ask — never guess and proceed.

## V1 status (as of 2026-04-23)

Core mechanics, outside-in architecture, complete property matrix, root cause analysis loop, color normalization, pre-flight interactive QA (Step 0c), and the full v0.3–v0.7 hardening pass are all implemented. Remaining before v1.0.0 stable:
- CI enforcement gate
- Real run threshold calibration (Issue #6)
- UX polish (Issue #7)

## Roadmap

See `docs/pixel-twin-v2-design.md` for current architecture. See GitHub issues for v3/v4 feature plans.
