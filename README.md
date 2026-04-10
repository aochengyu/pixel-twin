# datavant:ui-implement

A Claude Code skill that automates the frontend UI implementation loop — from Figma design to pixel-accurate, code-quality-compliant implementation.

**Status: v0.1 — Design complete, implementation in progress**

The design spec is based on first principles and needs calibration against real runs. Thresholds, agent prompts, and scripts will be refined iteratively.

---

## What it does

Given a Figma URL (and optional Jira ticket), the skill:

1. Detects whether the UI is new (Build Mode) or existing (Upgrade Mode)
2. Implements or refines the component(s) using exact Figma Inspect values
3. Runs Visual Review (computed styles + screenshot diff) and Code Review in parallel
4. Iterates until both pass, surfacing checkpoints to the engineer along the way
5. Produces a final sign-off with side-by-side comparison and changed file list

The success bar: a designer looking at the running app and the Figma mock side-by-side cannot tell which is which.

---

## Usage

```
/ui-implement <figma_url> [jira_ticket_url]
```

Or paste a Figma URL in conversation — the skill will offer to activate.

---

## Prerequisites

- Figma MCP connected and authenticated
- Dev server runnable via `npm run dev` (auto-started if not running)
- Playwright available (`npx playwright`)
- Atlassian MCP configured (optional, for Jira ticket reading)

---

## Installation

```bash
# Install as a Claude Code plugin (once published)
claude plugin install datavant/datavant-ui-implement
```

---

## Project structure

```
skills/
  ui-implement.md          # Main orchestrator skill
  ui-implement-review.md   # Visual + Code Review subagent skill
scripts/
  screenshot.ts            # Playwright screenshot utility
  computed-styles.ts       # CSS computed styles extractor
  pixelmatch-compare.ts    # Image diff utility
docs/
  design-spec.md           # Full design specification
```

---

## Configuration

Create `.claude/ui-implement.config.ts` in your project to override defaults:

```typescript
export const config = {
  commands: {
    dev: "npm run dev",
    typecheck: "npm run typecheck",
    lint: "npm run lint",
    test: "npm run test"
  },
  dev: {
    port: 3000,
    mockLoginUrl: "/login",
    authHelper: "e2e/helpers/auth.ts"
  }
}
```

Datavant-specific conventions (PHI/PII safety, `@datavant/dart`, React Router 7 patterns) are built in and do not need configuration.

---

## Design

See [`docs/design-spec.md`](docs/design-spec.md) for the full architecture.

Key decisions:
- Figma read **on-demand** per component (not pre-processed upfront)
- **Computed styles** as primary verification (data-independent, exact px/hex values)
- **Screenshot** as secondary verification (structure, visual weight, icons)
- Visual Review + Code Review run **in parallel** as stateless subagents
- **Two modes**: Build (new UI from scratch) and Upgrade (targeted fixes to existing UI)
- Thresholds calibrated on first real run — not defined upfront

---

## Known limitations (v1)

- Animations and micro-interactions not verified
- Responsive/breakpoint verification not in scope
- Exact diff thresholds TBD (calibrated on real runs)
