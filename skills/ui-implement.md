---
name: ui-implement
description: Pixel-accurate UI implementation from Figma. Runs an automated implement → verify → fix loop until visual and code quality both pass. Supports Build Mode (new UI from scratch) and Upgrade Mode (targeted fixes to existing UI).
---

# datavant:ui-implement

> **Implementation status:** Skill logic is a placeholder. The architecture is fully specified in `docs/design-spec.md`. The skill will be implemented iteratively, calibrated against real runs.

---

## Inputs

- `figma_url` (required) — Figma frame URL (node-id will be extracted automatically)
- `jira_ticket_url` (optional) — Jira ticket URL for supplementary business context (requires Atlassian MCP)

---

## Quick Reference

**What this skill does:**

1. Reads the Figma frame to understand the full scope of what needs to be built
2. Detects mode: **Build** (no existing component) or **Upgrade** (component exists — run audit first, generate Delta Report, fix only what's wrong)
3. Verifies the dev server is running — starts it automatically if not
4. Runs a component-by-component loop (outside-in: layout → sections → components → details):
   - **Implementation Agent** reads Figma on-demand, writes or fixes code, outputs a ReviewSpec
   - **Visual Review Agent** (stateless) — computed styles (primary) + screenshot diff (secondary)
   - **Code Review Agent** (stateless) — typecheck + lint + test + PHI/PII semantic check
   - Both review agents run in parallel, produce a CombinedReport
   - If blockers → CombinedReport sent back to Implementation Agent, loop continues
   - If no blockers → component done, next component
5. Checkpoint every 3 components (or when stuck): surfaces marginal issues for engineer to accept or fix
6. Full-page integration pass after all components pass — verifies cross-component spacing, alignment, visual rhythm, and explicitly designed interactive states
7. Final sign-off: side-by-side screenshot, verified property list, rendering deltas documented, full changed file list

**The skill never touches git.** The engineer reviews the diff and commits.

---

## Verification Architecture

### Computed Styles (primary — data-independent)

```typescript
// Playwright: extract all computed CSS for the target selector
const styles = await page.locator(selector).evaluate(
  el => Object.fromEntries(
    [...getComputedStyle(el)].map(prop => [prop, getComputedStyle(el).getPropertyValue(prop)])
  )
)
```

Compares against Figma Inspect values. Gives exact, actionable diffs:
`"padding-left: 12px, expected 16px (Figma: p-4)"`

### Screenshot (secondary — structural)

```typescript
// Playwright: screenshot of target selector
await page.locator(selector).screenshot({ path: 'actual.png' })

// pixelmatch: structural diff (text areas masked)
const diff = await runPixelmatch('actual.png', 'figma.png', 'diff.png')

// Claude Vision: semantic spot-check on diff image
```

Text content areas are masked — only structure, layout, colors, and icons are compared.

### Three diff categories

| Category | Definition | Action |
|----------|-----------|--------|
| **Structural** | Wrong layout, obvious misalignment, wrong color | Always block |
| **Marginal** | Spacing 2–3px off, slightly different shade | Surface at checkpoint, engineer decides |
| **Rendering Delta** | Font anti-aliasing, shadow blur algorithm difference | Never block — documented in sign-off |

---

## Code Review Checks

### Phase 1 — Automated (parallel)
```bash
npm run typecheck
npm run lint
npm run test
```

### Phase 2 — Semantic (Sonnet, only if Phase 1 passes)

- **PHI + PII safety**: no raw logging of patient names, DOB, SSN, MRN, requester names, emails, addresses; correct use of `sanitizeRoiRequestParams()`, `sanitizeErrorMessage()`, `getRequestLogger()`
- **`@datavant/dart` reuse**: are existing dart components used where applicable? Is any logic reinventing existing utilities in `lib/` or `services/`?
- **Pattern adherence**: `.server.ts` suffix, barrel exports, path aliases (`@client/*`, `@server/*`), React Router 7 loader/action, Zod validation at boundaries
- **React correctness**: no `useEffect` for loader work, correct hook dependencies, appropriate component granularity

---

## Model Assignments

| Agent | Model |
|-------|-------|
| Orchestrator | Haiku |
| Implementation Agent | Sonnet (default) / Opus (stuck or complex) |
| Visual Review Agent | Haiku |
| Code Review — Phase 1 | Haiku |
| Code Review — Phase 2 | Sonnet |

---

## Configuration

Reads `.claude/ui-implement.config.ts` from the project root if present. Falls back to defaults:

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

Hardcoded (not configurable): `@datavant/dart`, PHI + PII rules, Datavant codebase conventions.

---

## Prerequisites

- Figma MCP connected and authenticated (`figma@claude-plugins-official` enabled)
- Dev server runnable via the configured command (auto-started if not running)
- Playwright available (`npx playwright`)
- Atlassian MCP (optional, for Jira context — `claude mcp add atlassian`)

---

## Skill Execution Placeholder

```
TODO: Implement Orchestrator logic here.

Reference: docs/design-spec.md

Steps:
1. Parse figma_url → extract fileKey + nodeId
2. (If jira_ticket_url) → fetch ticket via Atlassian MCP
3. Read Figma metadata → build component queue (outside-in order)
4. Scan codebase → detect Build or Upgrade mode
5. (Upgrade only) → run audit → generate DeltaReport → filter queue
6. Verify dev server → auto-start if needed
7. Component loop (see design-spec.md §10):
   a. Spawn Implementation Agent (Sonnet/Opus)
   b. Spawn Visual Review Agent + Code Review Agent in parallel (Haiku/Sonnet)
   c. Merge reports → CombinedReport
   d. hasBlockers? loop : next component
   e. Every 3 components → Checkpoint
8. Full-page integration pass
9. Final sign-off
```
