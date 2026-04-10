# pixel-twin

A Claude Code skill that automates the frontend UI implementation loop — from Figma design to pixel-accurate, code-quality-compliant implementation.

The name says it all: when the skill works, the running app and the Figma mock are indistinguishable side-by-side. They are pixel twins.

**Status: v0.1 — Design complete, implementation in progress**

---

## What it does

Given a Figma URL (and optional Jira ticket), the skill:

1. Detects whether the UI is new (**Build Mode**) or existing (**Upgrade Mode**)
2. Implements or refines components using exact Figma Inspect values
3. Runs Visual Review (computed styles + screenshot diff) and Code Review in parallel
4. Iterates until both pass, surfacing checkpoints to the engineer along the way
5. Produces a final sign-off with side-by-side comparison and changed file list

The success bar: a designer looking at the running app and the Figma mock side-by-side cannot tell which is which.

---

## Usage

```
/pixel-twin <figma_url> [jira_ticket_url]
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
# Clone and register as a local Claude Code skill
git clone https://github.com/aochengyu/pixel-twin.git
```

Plugin distribution coming once v1.0 is stable.

---

## Project structure

```
skills/
  pixel-twin.md            # Main orchestrator skill
scripts/
  screenshot.ts            # Playwright screenshot utility
  computed-styles.ts       # CSS computed styles extractor
  pixelmatch-compare.ts    # Image diff utility
docs/
  design-spec.md           # Full architecture specification
CHANGELOG.md               # Version history
```

---

## Configuration

Create `.claude/pixel-twin.config.ts` in your project to override defaults:

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
    authHelper: "e2e/helpers/auth.ts",
    designSystem: "@your-org/design-system"
  }
}
```

---

## Roadmap

See [`docs/design-spec.md`](docs/design-spec.md) for the full architecture and [`CHANGELOG.md`](CHANGELOG.md) for version history.

| Version | Theme | Status |
|---------|-------|--------|
| v0.1 | Design complete, scaffold | Done |
| v1.0 | First working implementation (Build + Upgrade modes) | In progress |
| v2.0 | Interactive states, animations, form validation | Planned |
| v3.0 | Responsive/breakpoints, Storybook, multi-design-system | Planned |

---

## Design

See [`docs/design-spec.md`](docs/design-spec.md) for the full architecture.

Key decisions:
- Figma read **on-demand** per component (not pre-processed upfront)
- **Computed styles** as primary verification (data-independent, exact px/hex values)
- **Screenshot** as secondary verification (structure, visual weight, icons)
- Visual Review + Code Review run **in parallel** as stateless subagents
- **Two modes**: Build (new UI from scratch) and Upgrade (targeted fixes to existing UI)
- **Three diff categories**: Structural (always block) / Marginal (engineer decides) / Rendering Delta (never block)
