# datavant:ui-implement — Design Specification

**Date:** 2026-04-10
**Author:** aochengyu
**Status:** Draft — pending implementation plan

---

## 1. Goal

Build a Claude Code skill (`datavant:ui-implement`) that automates the frontend UI implementation loop — from Figma design to pixel-accurate, code-quality-compliant implementation — with minimal human intervention between iterations.

**Ambition level:** The skill should reach the point where it can almost fully replace an engineer for UI implementation tasks. In the near term, it dramatically boosts every Datavant engineer's productivity: small tasks like implementing a single component become nearly instant; large tasks like building a full page from scratch become a matter of oversight rather than active coding.

**Company-wide design system benefit:** Every engineer who uses this skill gets automatic enforcement of the project's configured design system — correct component usage, correct token usage, no reinvention. The skill makes design system adoption a default outcome rather than a manual review step. (`@datavant/dart` is the current default for Datavant projects; other design systems are configurable.)

**Success bar:** A designer looking at the running app and the Figma mock side-by-side cannot tell which is which.

---

## 2. Trigger

Two entry points, both supported:

**A. Skill invocation**
```
/pixel-twin <figma_url> [jira_ticket_url]
```
Invoking the skill IS confirmation — no additional prompt is shown. Implementation begins immediately.

**B. Conversation**
When a Figma URL appears in conversation, the workflow offers to activate and waits for the engineer to confirm before beginning. Jira context is supplementary — the workflow runs without it.

---

## 3. Two Modes

The Orchestrator detects which mode to use at startup by scanning the codebase for existing components/routes that correspond to the Figma frame.

### Build Mode (New UI)
- No existing component found
- Implementation Agent creates new files from scratch
- Full verification coverage: every element, every style, every state
- More iterations expected

### Upgrade Mode (Existing UI)
- Component/route already exists
- Orchestrator runs an audit first: compare current implementation against Figma
- Generates a Delta Report:
  ```typescript
  interface DeltaReport {
    alreadyCorrect: string[]   // CSS properties / elements already matching Figma
    needsFix: {
      selector: string
      property: string
      current: string
      expected: string
    }[]
    missingElements: string[]  // elements in Figma not found in current implementation
  }
  ```
- Implementation Agent makes targeted fixes only (skips already-correct areas)
- Review covers only changed areas
- Fewer iterations expected

---

## 4. Model Assignments

Model selection follows the principle: use the cheapest model that can reliably handle the judgment required.

| Agent | Model | Rationale |
|-------|-------|-----------|
| **Orchestrator** | Haiku | Routing and state management — no deep reasoning needed |
| **Implementation Agent** | Sonnet (default) / Opus (escalation) | Core creative work — code generation, Figma interpretation, fix synthesis. Opus used when stuck after multiple failed iterations or when the component is highly complex. |
| **Visual Review Agent** | Sonnet | Diff categorization (Structural / Marginal / Rendering Delta) requires judgment — Haiku miscategorizes edge cases. Scripts handle all computation; Sonnet handles only the categorization step. |
| **Code Review Agent — Phase 1** | Haiku | Runs shell tools (`typecheck`, `lint`, `test`) — purely mechanical |
| **Code Review Agent — Phase 2** | Sonnet | Semantic analysis of changed code — needs language understanding |

Cost profile: most iterations are cheap (Haiku for review, Sonnet for implementation). Opus is reserved as an escalation path — never used by default.

---

## 5. Agent Architecture

Three roles. No more, no less.

```
┌──────────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR                                                      │
│  · Detects mode (Build / Upgrade)                                 │
│  · Verifies dev server is running (auto-starts if not)            │
│  · Manages component queue and iteration count                    │
│  · Triggers checkpoints every N components                        │
│  · Decides termination (all pass) or escalation (stuck)           │
└───────────────────────────┬──────────────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │   COMPONENT LOOP           │
              │                            │
              │  ┌─────────────────────┐  │
              │  │ IMPLEMENTATION      │  │
              │  │ AGENT               │  │
              │  │                     │  │
              │  │ · get_design_       │  │
              │  │   context(node)     │  │
              │  │   on-demand         │  │
              │  │ · Reads codebase    │  │
              │  │ · Reads previous    │  │
              │  │   CombinedReport    │  │
              │  │ · Writes/fixes code │  │
              │  │ · Outputs ReviewSpec│  │
              │  └──────────┬──────────┘  │
              │             │              │
              │    ┌────────┴────────┐     │
              │    │   PARALLEL      │     │
              │    ▼                 ▼     │
              │  ┌──────────┐ ┌──────────┐│
              │  │ VISUAL   │ │  CODE    ││
              │  │ REVIEW   │ │  REVIEW  ││
              │  │ AGENT    │ │  AGENT   ││
              │  │(stateless│ │(stateless││
              │  │subagent) │ │subagent) ││
              │  └────┬─────┘ └────┬─────┘│
              │       └─────┬──────┘      │
              │             ▼             │
              │      CombinedReport       │
              │             │             │
              │     Both pass?            │
              │       Yes → next component│
              │       No  → Impl Agent    │
              └───────────────────────────┘
```

---

## 6. Implementation Agent

### Inputs
- `get_design_context(figmaNodeId)` — called **on-demand per component**, not pre-processed upfront. This ensures fresh data if the design changes, and avoids wasting tokens on components not yet being worked on.
- Jira ticket context (if provided) — supplementary business logic
- Previous `CombinedReport` (if this is a re-iteration)
- Current codebase structure

### What it reads from Figma
Using Figma Inspect values directly:
- Exact spacing values (padding, margin, gap — all four sides)
- Exact colors (hex, rgba, opacity)
- Typography (font-family, font-size, font-weight, line-height, letter-spacing)
- Border and radius values
- Shadow values
- Component variants and states shown in the frame
- Placeholder data — used to infer **data density** (string lengths, which states are visible)

### Content Density Fixture
The Implementation Agent analyzes Figma placeholder data to generate an MSW fixture for the Review Agent. The fixture matches:
- **String length/density** of placeholder text (not the exact content)
- **UI state-determining values** exactly (e.g., `requestType: "CoC"` determines which Tag variant renders; `dueDate: tomorrow` determines which due-date label appears)
- **Layout-affecting values** (e.g., address length that causes wrapping)

### Output: ReviewSpec
```typescript
interface ReviewSpec {
  selector: string         // '[data-testid="request-sidebar"]'
  url: string              // '/details/42'
  fixtureOverrides: object // MSW data overrides for consistent visual state
  figmaNodeId: string      // for Review Agent to fetch Figma screenshot
  subComponents: {         // child components to verify individually
    name: string
    selector: string
    figmaNodeId: string
  }[]
}
```

### data-testid convention
If the component does not have a `data-testid` on its root element, the Implementation Agent adds one as part of the code change. This is consistent with existing E2E test conventions in this codebase (`e2e/pages/`).

---

## 7. Visual Review Agent (stateless)

Spawned fresh each verification round — no memory of previous rounds, ensuring zero bias.

### Two-track verification

**Track A — Computed Styles (primary)**
```
Playwright: page.locator(selector).evaluate(
  el => window.getComputedStyle(el)
)
```
- Compares every CSS property against Figma Inspect values
- Completely data-independent (not affected by what data is displayed)
- Gives exact, actionable diffs: "padding-left: 12px, expected 16px"

**Track B — Screenshot (secondary)**
```
Playwright: page.screenshot() vs Figma screenshot (via get_design_context)
pixelmatch for structural diff
Claude Vision for semantic spot-check
```
- Text content areas are masked — only structure, layout, colors, and icons are compared
- Catches visual issues that computed styles cannot (e.g., icon misalignment, visual weight)

### Three categories of difference
| Category | Definition | Action |
|----------|-----------|--------|
| **Structural** | Wrong layout, obvious misalignment, completely wrong color | Always block — must fix |
| **Marginal** | Spacing 2-3px off, color slightly different | Surface at checkpoint — engineer decides |
| **Rendering Delta** | Font anti-aliasing, shadow blur algorithm differences | Never block — documented in sign-off report |

Note: exact pixel thresholds are **not defined upfront**. They are calibrated on the first real run using actual diff images. The three categories above give the framework for that calibration.

### Auth
Before navigating, Review Agent authenticates using the project's mock login mechanism (`e2e/helpers/auth.ts`). Session cookie is carried for all subsequent Playwright operations.

---

## 8. Code Review Agent (stateless)

Spawned fresh each verification round in parallel with Visual Review Agent.

### Phase 1 — Automated tools (run in parallel)
```bash
npm run typecheck   # TypeScript correctness
npm run lint        # ESLint: imports, conventions, custom rules
npm run test        # Vitest: no regressions in existing tests
```
If any Phase 1 tool fails → immediately return failure report, skip Phase 2.

### Phase 2 — Claude semantic analysis (only if Phase 1 passes)
Reads only the changed files. Runs three configurable check categories:

**Safety Profile** (`safetyProfile` in config — see §14)
Generic: no sensitive data in logs, no sensitive data in URL params, no sensitive data in client-side state.
Default (Datavant): HIPAA/PHI+PII rules — no raw logging of patient names/DOB/SSN/MRN/requester info; use project-configured sanitization utilities; no PHI/PII in URL params.

**Design System Reuse**
- Are existing components from the configured `designSystem` used where applicable?
- Is any logic reinventing something the design system already provides?

**Convention Profile** (`conventionProfile` in config — see §14)
A named set of codebase conventions to enforce. The agent checks changed files against this profile.
Default (Datavant): `.server.ts` suffix for server-only code, barrel exports, path aliases (`@client/*`, `@server/*`), React Router 7 loader/action pattern, Zod validation at system boundaries.
Other teams configure or disable this to match their stack.

**React Correctness** (always on — not project-specific)
- No `useEffect` for work that belongs in a loader/effect boundary
- Hook dependency arrays correct
- Component granularity appropriate

### Output: CodeReviewReport
```typescript
interface CodeReviewReport {
  phase1: {
    typecheck: 'pass' | 'fail'
    lint: 'pass' | 'fail'
    tests: 'pass' | 'fail'
    errors: string[]
  }
  phase2: {
    issues: {
      file: string
      line?: number
      severity: 'blocker' | 'warning'
      category: 'phi-pii-safety' | 'reuse' | 'pattern' | 'react'
      issue: string
      suggestion: string
    }[]
  }
  hasBlockers: boolean
}
```

---

## 9. CombinedReport

Merges VisualDiffReport and CodeReviewReport into a single input for the Implementation Agent.

```typescript
interface CombinedReport {
  iteration: number
  visualIssues: {
    type: 'computed-style' | 'screenshot'
    selector: string
    property?: string
    expected?: string
    actual?: string
    description: string
    severity: 'blocker' | 'marginal' | 'rendering-delta'
    file?: string
    fix: string         // concrete suggestion: "change p-3 → p-4" — required, never omitted
  }[]
  codeIssues: CodeReviewReport['phase2']['issues']
  hasBlockers: boolean
  visualPassRate: string  // human-readable, e.g. "8/10 properties match"
}
```

---

## 10. Loop Flow

### Component Queue
At startup, the Orchestrator builds the component queue by reading the Figma frame structure via `get_metadata`:
- Identifies top-level frames and nested components in the target node
- Orders them outside-in: page layout → major sections → individual components → micro-details
- In Upgrade Mode: filters queue to only components flagged in the Delta Report

```
For each component (outside-in: layout → sections → components → details):

  1. Implementation Agent reads Figma, writes/fixes code, outputs ReviewSpec
  2. Visual Review Agent + Code Review Agent run in parallel
  3. Both produce reports → merged into CombinedReport
  4. hasBlockers?
       No  → component done, move to next
       Yes → CombinedReport sent back to Implementation Agent, loop
  
  Rendering Deltas → auto-documented, never escalated
  High-confidence marginals → auto-resolved, logged
  Low-confidence marginals or stuck → Checkpoint (see §11)

After all components pass → Full-page Integration Pass
  · Screenshot at exact Figma frame dimensions
  · Verify spacing between components, alignment, visual rhythm
  · Verify interactive states that are explicitly designed in Figma
    (only states with a corresponding Figma frame/variant — not hypothetical states)
  · Same Visual + Code Review agents

Final Sign-off:
  · Side-by-side: Figma screenshot vs app screenshot
  · List of verified computed style properties
  · Remaining rendering deltas documented and explained
  · Full list of changed files for engineer to review and commit
```

---

## 11. Checkpoint

### Autonomous mode (default)

The skill operates autonomously end-to-end. Human input is requested **only** when:

1. **Low-confidence marginals exist** — the agent cannot determine with confidence whether to fix or accept (e.g., a 1px spacing difference that could be a rendering delta or a real error)
2. **Genuinely stuck** — the agent has exhausted its own escalation ladder (see below) and still cannot pass review

All other cases are handled autonomously:
- Rendering Deltas → auto-documented, never surfaced for human judgment
- High-confidence marginals → auto-applied with a log entry ("auto-accepted: shadow spread 3px vs 4px — rendering delta")
- Code blockers → fixed autonomously and re-reviewed

### Stuck escalation ladder

Before surfacing to human, the agent works through this ladder autonomously:

```
Iteration N — same blocker persists:
  1. Re-read the Figma node directly (designs may have subtleties missed on first read)
  2. Read related files (parent components, design tokens, existing similar implementations)
  3. Try a different implementation approach (alternative CSS, different component variant)
  4. Escalate model: Sonnet → Opus (one escalation per stuck cycle)
  5. ── Only if still stuck after all of the above ──
     Surface to human with a full diagnosis: what was tried, why it failed, what hint would help
```

### When checkpoint does surface

Only low-confidence marginals and genuinely-stuck escalations reach the engineer:

```
⚠️ pixel-twin — input needed / component: RequestSidebar (iteration 4)

What I tried:
  · 3 CSS approaches for box-shadow — none match Figma exactly
  · Figma shows shadow: 0 4px 8px rgba(0,0,0,0.12), browser renders 0 3px 7px
  · This looks like a rendering delta, but I'm not confident enough to auto-accept

Low-confidence marginals:
  · box-shadow spread: 3px vs 4px
    → Likely rendering delta. Recommend: accept. Confidence: 70%
  · Tag padding-right: 11px vs 12px
    → Could be a real error or sub-pixel rounding. Recommend: fix. Confidence: 60%

Options:
  A. Accept all and continue (I'll document them in the sign-off)
  B. Fix Tag padding, accept shadow, continue
  C. Hint: [tell me something about the design intent]
```

### Supervised mode (opt-in)

Set `checkpointEvery: 3` in config to restore the periodic checkpoint behavior. Useful during initial calibration runs.

---

## 12. Dev Server Prerequisite

At startup, Orchestrator verifies the dev server:

```
1. Ping localhost:{port}
2. If not running → execute `npm run dev`, wait for ready signal
3. If startup fails → stop workflow, surface error to user
4. If already running on different port → use detected port
```

---

## 13. Git Workflow

The workflow **only modifies files**. It never touches git.

- Works on the current branch (engineer's responsibility to branch before starting)
- No `git add`, no `git commit`, no `git push`
- At each checkpoint: lists files modified so far
- At final sign-off: full list of all changed files, ready for engineer to review and commit

---

## 14. Configuration

Create `.claude/pixel-twin.config.ts` in your project root to override defaults:

```typescript
// .claude/pixel-twin.config.ts (optional, project-level override)
export const config = {
  commands: {
    dev: "npm run dev",
    typecheck: "npm run typecheck",
    lint: "npm run lint",
    test: "npm run test"
  },
  dev: {
    port: 3000,
    authHelper: "e2e/helpers/auth.ts",   // path to Playwright auth setup
    designSystem: "@datavant/dart"        // enforced in Code Review Phase 2
  },
  review: {
    // safetyProfile: which sensitive-data rules to enforce in Code Review Phase 2
    // "datavant-hipaa" = PHI/PII rules with Datavant-specific sanitization utilities
    // "basic"         = generic: no sensitive data in logs/URLs
    // "none"          = skip safety checks
    safetyProfile: "datavant-hipaa",

    // conventionProfile: which codebase conventions to enforce
    // "datavant"  = barrel exports, .server.ts, @client/@server aliases, RR7 patterns
    // "none"      = skip convention checks
    conventionProfile: "datavant",

    // checkpointEvery: periodic checkpoint even when no marginals (supervised mode)
    // Default: undefined (autonomous — only checkpoint when genuinely needed)
    checkpointEvery: undefined
  }
}
```

Defaults without a config file: `safetyProfile: "datavant-hipaa"`, `conventionProfile: "datavant"` — i.e., full Datavant conventions out of the box. Other teams set their own profiles or `"none"` to disable.

---

## 15. Skill Name

**`pixel-twin`**

- Name reflects the goal: when the skill succeeds, the running app and the Figma mock are indistinguishable — they are pixel twins
- Not tied to Figma specifically (works with any design tool input in future)
- Covers both Build Mode and Upgrade Mode
- When distributed under a company namespace: `datavant:pixel-twin`

Skill invocation: `/pixel-twin <figma_url> [jira_ticket_url]`

---

## 16. User Experience Design

The skill must feel like working alongside a senior engineer, not a chatbot running a script. Every output should be immediately actionable.

### Progress Reporting

At each step the Orchestrator surfaces a compact status line — never silent for more than one component:

```
[ui-implement] Analyzing Figma frame... done (8 components queued)
[ui-implement] Build Mode — no existing component found
[ui-implement] [1/8] Header — implementing...
[ui-implement] [1/8] Header — reviewing (visual + code in parallel)...
[ui-implement] [1/8] Header — ✓ pass (3 computed-style checks, 0 code blockers)
[ui-implement] [2/8] FilterSidebar — implementing...
```

### Actionable Diff Output

When blockers are found, the output tells the engineer exactly what failed and why — not just "there's a problem":

```
[ui-implement] [2/8] FilterSidebar — 2 blockers
  Visual:
    · [blocker] padding-left: 12px → expected 16px (Figma: p-4)
      Fix: change p-3 to p-4 on <FilterSidebar> root div
    · [blocker] background-color: #F5F5F5 → expected #FAFAFA
      Fix: use dart token bg-subtle instead of bg-muted
  Code:
    · [blocker] Raw patient name logged at filter.ts:47
      Fix: wrap in sanitizeRoiRequestParams()
```

### Checkpoint UX

Checkpoints are designed to be fast to read and easy to respond to. The engineer should be able to triage a checkpoint in under 30 seconds:

```
━━━ Checkpoint (3 components done) ━━━

✓ Header          — all pass
✓ FilterSidebar   — all pass
✓ TabBar          — all pass

No marginal items. Continue? [Y/n]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If marginal items exist, they are listed with a suggested disposition:

```
━━━ Checkpoint (6 components done) ━━━

Marginal items (your call):
  · RequestSidebar — box-shadow spread: 3px vs 4px
    → Likely rendering delta (browser shadow algorithm). Recommend: accept.
  · Tag — padding-right: 11px vs 12px
    → 1px off. Could matter at small size. Recommend: fix.

A. Accept all marginals and continue
B. Fix Tag padding, accept shadow, continue
C. Provide a hint

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Final Sign-off

The sign-off gives the engineer everything they need to commit with confidence:

```
━━━ Implementation complete ━━━━━━━━━━━━

Side-by-side comparison: [Figma screenshot] vs [app screenshot]

Verified:
  ✓ 47 computed style properties across 8 components
  ✓ TypeScript, lint, and tests — all pass
  ✓ No safety issues (safetyProfile: datavant-hipaa)
  ✓ Design system components used correctly (@datavant/dart)

Rendering deltas (documented, not blocking):
  · Font anti-aliasing: expected behavior, browser-native
  · box-shadow blur: 3px vs 4px (browser algorithm difference)

Changed files:
  client/features/RequestSidebar/RequestSidebar.tsx
  client/features/RequestSidebar/RequestSidebar.module.css
  client/features/FilterSidebar/FilterSidebar.tsx

No git changes made. Review the diff and commit when ready.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Error UX

When something goes wrong (dev server won't start, Figma node not found, stuck after 5 iterations), the skill surfaces a clear human-readable explanation with a suggested resolution — never a raw stack trace.

---

## 17. Roadmap (v2 / v3)

These items are out of scope for v1 but the architecture is designed to accommodate them without major rewrites.

### v2 — Interaction and State Coverage

**Interactive state verification**
- Currently: only explicitly designed states in Figma (existing frames/variants) are verified
- v2: verify hover, focus, active states by triggering them via Playwright `.hover()`, `.focus()`, `.click()`
- Requires: a state matrix extracted from the Figma component's variants

**Animation and transition verification**
- Currently: out of scope (no visual verification of motion)
- v2: verify CSS transition properties (duration, easing) match design tokens
- Requires: a motion design token system in `@datavant/dart`

**Form validation state verification**
- Currently: happy-path visual state only
- v2: verify error states (field border, error message styling) using the Content Density Fixture

### v2 — Broader Design Tool Support

**Design token mapping**
- v2: When Figma uses a design token name (not raw hex), resolve it to the `@datavant/dart` token and verify the component uses the token, not the hardcoded value

**Figma variant enumeration**
- v2: When a component has Figma variants (e.g., Button: primary/secondary/danger), automatically queue each variant for verification

### v3 — Responsive and Multi-Breakpoint

**Breakpoint verification**
- Currently: only the Figma frame's native dimensions are verified
- v3: detect breakpoint frames in Figma (mobile, tablet, desktop), screenshot at each viewport, verify layout collapses correctly
- Requires: Playwright viewport switching + breakpoint-aware Figma node enumeration

**Storybook integration**
- v3: instead of navigating a running app, render the component in Storybook and verify against Figma — removes dependency on auth and full app state

### v3 — Broader Adoption

**Richer design system integration**
- Currently: configurable by name (`designSystem` in config), Code Review Agent checks for reuse
- v3: deeper integration — parse design system's component API docs at startup, give Implementation Agent concrete component usage examples rather than just a name

**Figma Dev Mode annotations**
- v3: read Figma Dev Mode annotations (if designer has added implementation notes) and incorporate into Implementation Agent context

---

## 18. Known Limitations

- Requires Figma MCP to be connected and authenticated
- Atlassian MCP for Jira ticket reading requires separate setup (see: `claude mcp add atlassian`)
- Jira ticket is supplementary — workflow runs without it
- Exact diff thresholds must be calibrated on first real run (cannot be defined without visual reference)
- Animations and micro-interactions are out of scope for visual verification (v2)
- Responsive/breakpoint verification is out of scope for v1 (v3)
