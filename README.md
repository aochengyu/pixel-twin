# pixel-twin

A Claude Code skill that automates the frontend UI implementation loop — from Figma design to pixel-accurate, code-quality-compliant implementation.

The name says it all: when the skill works, the running app and the Figma mock are indistinguishable side-by-side. They are pixel twins.

**Status: v0.2.0 — pre-flight QA, mandatory property matrix, and dart auto-detection complete. Threshold calibration and CI gate pending. See [`CHANGELOG.md`](CHANGELOG.md) for current feature status.**

---

## What it does

Given a page-level Figma frame URL, the skill:

1. Detects whether the UI is new (**Build Mode**) or existing (**Upgrade Mode**)
2. Builds a **Coverage Map** — a systematic checklist of every CSS property to verify, with selectors and expected values derived from Figma and Dart V1 design tokens
3. Implements or fixes components using exact Figma values, outside-in (Level 0 → 1 → 2 → 3)
4. Verifies each component against the Coverage Map via computed styles
5. Iterates until all Coverage Map rows pass, then moves to the next component
6. Produces a final report of pass/fail counts and any Figma inconsistencies flagged for the designer

The success bar: a designer looking at the running app and the Figma mock side-by-side cannot tell which is which.

---

## Usage

```
/pixel-twin <page-level-figma-url>
```

- URL must be a page-level frame (right-click → Copy link to selection on the outermost frame in Figma)
- If the URL is too broad (root canvas), pixel-twin will list top-level frames for you to select

---

## Prerequisites

- Figma MCP connected and authenticated
- Dev server runnable (auto-started if not running)
- `npx tsx` available (TypeScript script runner)

---

## Installation

```bash
# Clone and register as a local Claude Code skill
git clone https://github.com/aochengyu/pixel-twin.git
```

Plugin distribution coming once v2.0 is stable.

---

## Project structure

```
skills/
  pixel-twin.md                  # Main orchestrator skill (self-contained)
  agents/
    implementation-agent.md      # Implements / fixes components (Opus)
    visual-review-agent.md       # Runs computed-styles verification (Sonnet)
    code-review-agent.md         # CSS/prop + semantic code review (Haiku → Sonnet)
    dart-knowledge.md            # Dart V1 design system reference
scripts/
  computed-styles.ts             # Batch CSS computed styles extractor (Playwright)
  bounding-boxes.ts              # Bounding box comparison utility
  screenshot.ts                  # Playwright screenshot utility
  auth-integrated-roi.ts         # Auth helper for integrated-roi project
docs/
  pixel-twin-v2-design.md        # Current architecture specification (v2)
  design-spec.md                 # v1 architecture specification (superseded)
CHANGELOG.md                     # Version history
```

---

## Configuration

Create `.claude/pixel-twin.config.ts` in your project to override defaults:

```typescript
export const config = {
  port: 3000,
  srcDir: ".",
  designSystem: "@your-org/design-system",
  designSystemKnowledgePath: null,
  safetyProfile: "none",
  conventionProfile: "none",
  auth: ".claude/pixel-twin-auth.ts"  // path to Playwright auth helper
}
```

---

## Roadmap

See [`docs/pixel-twin-v2-design.md`](docs/pixel-twin-v2-design.md) for the current architecture and [`CHANGELOG.md`](CHANGELOG.md) for version history.

| Version | Theme | Status |
|---------|-------|--------|
| v0.1.0 | First complete implementation — all four agents, Coverage Map architecture, closed verify-fix loop | Released 2026-04-10 |
| v0.2.0 | Pre-flight interactive QA, mandatory property matrix, dart auto-detection, color normalization, root cause analysis | Released 2026-04-21 |
| v1.0.0 | Stable release — Build/Upgrade modes calibrated, CI gate enforced, threshold calibrated | Planned |
| v2.0.0 | Interactive states, animations, form validation | Planned |
| v3.0.0 | Responsive/breakpoints, Storybook, multi-design-system | Planned |

---

## Key Design Decisions

- **Coverage Map as primary mechanism**: systematic checklist of CSS properties per component; Orchestrator context stays O(1) via file-based state
- **Source of truth = Dart V1 design tokens**: Figma values are cross-referenced but not trusted; discrepancies are flagged to the designer, not treated as failures
- **Sequential sub-agents only**: Implementation → Visual Review → Code Review run sequentially per component; never parallel (parallel agents block each other)
- **Computed styles as the verification method**: exact px/hex/rgb values from the browser; no screenshot diffs for pass/fail decisions
- **Outside-in development**: Level 0 (page shell) → 1 (sections) → 2 (components) → 3 (micro-details); each level verified before going deeper
- **Self-contained skill**: pixel-twin depends only on Figma MCP, `npx tsx` scripts, and Claude Code's native Agent tool — no external skill frameworks
