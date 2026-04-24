# pixel-twin v2 Design Spec

**Date:** 2026-04-13
**Status:** Implemented — v2 is in production. See CHANGELOG for the full version history. Post-spec additions through v0.7.0 are documented in Section 20 below.

---

## 1. Root Cause Analysis

Why v1 failed to achieve ~100% pixel-match (all confirmed):

1. **No automatic triggering** — every step required manual intervention, loops broke easily
2. **Fake orchestration** — all logic ran linearly in the main context; no real sub-agent spawning
3. **Ad-hoc coverage** — no systematic property checklist; whatever got checked was arbitrary
4. **Loop never closed** — found diffs but no automatic fix → re-verify cycle
5. **Unreliable Figma → CSS mapping** — `get_design_context` returns Tailwind classes that don't map directly to computed styles

---

## 2. Design Principles

- **Only the result matters**: browser UI matches Figma ~100%. Coverage Map is an internal tool, not something the engineer needs to understand
- **Source of truth = Dart V1**: Figma stale → flag for designer, use Dart V1 value for verification, never a FAIL
- **Sequential, never parallel**: sub-agents are always stateless + sequential; parallel agents cause blocking
- **File-based state, O(1) context**: Orchestrator never accumulates context; all state is written to disk

---

## 3. Two Modes

### Build Mode (0 → 1)
Building a page from scratch. Given a page-level Figma frame URL, pixel-twin implements all components systematically outside-in.

### Upgrade Mode (modify existing)
Given a page-level Figma frame URL, pixel-twin automatically diffs current Figma state vs the existing Coverage Map, detects Changed / New / Moved components, and fixes each to ~100% match.

### Mode Auto-Detection
After receiving the URL, pixel-twin checks whether `.claude/pixel-twin/coverage-map-<frameId>.json` exists:
- **Does not exist** → Build Mode
- **Exists** → Upgrade Mode (run diff flow)

---

## 4. Invocation

```
/pixel-twin <page-level-figma-url>
```

- URL must be a page-level frame (right-click → Copy link to selection on the outermost frame)
- If URL is root canvas (too broad) → pixel-twin lists top-level frames for user to select
- **Scope per run = all components within one page-level frame**

---

## 5. Agent Architecture

### Sub-agents (Stateless + Sequential)

```
Orchestrator (Sonnet)
  └─ [per component, sequential]
       ├─ Implementation Agent (Opus)   ← build mode: implement; upgrade: fix
       ├─ Visual Review Agent (Sonnet)  ← run computed-styles, update Coverage Map
       └─ Code Review Agent
            ├─ Pass 1: Haiku  ← mechanical CSS/prop checks
            └─ Pass 2: Sonnet ← semantic-level review
```

**Model selection rationale:**
- **Opus** for Implementation Agent: minimize loop count, get it right the first time, reduce re-verify iterations
- **Sonnet** for Orchestrator + Visual Review + Code Review P2: reasoning tasks
- **Haiku** for Code Review P1: mechanical checks, cost-efficient

### Rules
- Each sub-agent writes results to disk immediately upon completion; context is cleared
- Orchestrator reads only from disk state; never accumulates cross-agent information in memory
- All sub-agents must be sequential; never parallel

### Dependency Constraints (Self-Contained Principle)
The only external dependencies pixel-twin is allowed:
- **Figma MCP**: `get_metadata`, `get_design_context`
- **TypeScript scripts**: `npx tsx scripts/*.ts` (computed-styles.ts, bounding-boxes.ts, etc.)
- **Claude Code native Agent tool**: spawn sub-agents directly, not through any skill framework

**Prohibited**: must not invoke brainstorming, writing-plans, or any superpowers skill. All logic in `pixel-twin.md` is self-contained. Sub-agent prompts are either embedded in `pixel-twin.md` or passed as standalone `skills/agents/*.md` files via the Agent tool's `prompt` parameter.

---

## 6. File-Based State

```
.claude/pixel-twin/
  coverage-map-<frameId>.json    ← Coverage Map (primary state)
  component-registry.json        ← Figma node-id → file path mapping
  queue-<frameId>.json           ← pending component queue (upgrade mode diff result)
  reports/
    <frameId>-report.md          ← verification results per run
```

**`queue-<frameId>.json` structure:**
```json
{
  "frameId": "209:11957",
  "pendingComponents": [
    { "nodeId": "14021", "figmaName": "Filter Sidebar", "reason": "changed" },
    { "nodeId": "66:8296", "figmaName": "DueDateBadge", "reason": "new" }
  ],
  "completedComponents": []
}
```
Orchestrator moves each component from `pendingComponents` to `completedComponents` upon completion. Mid-run interruptions can resume from remaining `pendingComponents`.

---

## 7. Coverage Map Structure

```json
{
  "frameId": "209:11957",
  "figmaUrl": "https://www.figma.com/design/...",
  "lastVerified": "2026-04-13T10:00:00Z",
  "prerequisites": {
    "url": "http://localhost:5173/requests?tab=all&page=1",
    "auth": "scripts/auth-integrated-roi.ts",
    "waitFor": "tbody tr",
    "viewport": { "width": 1440, "height": 1024 },
    "stableCondition": "network-idle",
    "setupInteractions": []
  },
  "rows": [
    {
      "selector": "[data-testid='filter-sidebar']",
      "figmaNodeId": "14021",
      "property": "background-color",
      "figmaValue": "rgb(255,255,255)",
      "dartV1Value": "rgb(255,255,255)",
      "figmaConflict": false,
      "expected": "rgb(255,255,255)",
      "actual": null,
      "status": "pending",
      "tolerance": "exact-after-hex-rgb"
    }
  ],
  "figmaDiscrepancies": []
}
```

**Three-way comparison logic:**
- `expected` = Dart V1 value (source of truth)
- `actual` = browser computed value (captured by Visual Review Agent)
- `figmaValue` ≠ `dartV1Value` → `figmaConflict: true`, recorded in `figmaDiscrepancies` — **not a FAIL**
- `actual` ≠ `expected` (outside tolerance) → **FAIL**, requires fix

---

## 8. Coverage Map Builder (run by Orchestrator)

1. `get_metadata` to get the full node tree for the frame
2. Filter auto-named nodes (see Section 11)
3. Identify ~4–6 significant containers (semantically-named nodes that group a UI section)
4. Call `get_design_context` on each significant container
5. **Value Extractor**: parse Tailwind class strings, extract CSS fallback values from `var(token, fallback)` pattern
6. **CSS Variable Extraction**: run `getComputedStyle(document.documentElement).getPropertyValue(cssVar)` against the running app to resolve Dart V1 token values
7. Three-way comparison → populate Coverage Map rows
8. Assign selectors (priority: data-testid > meaningful-ancestor + nth-child > HTML semantic)
9. Write to `.claude/pixel-twin/coverage-map-<frameId>.json`

---

## 9. `get_design_context` Call Strategy

- Called on significant containers (~4–6 per frame), not every leaf node
- Significant container: semantically-named node (non-auto-named) that groups a UI section
- Return format: Tailwind code with CSS values embedded as `var(token, fallback)`
- Value Extractor parses out fallback values → CSS property:value pairs

---

## 10. Figma Instance Boundary Handling

For dart/Mantine component instances, verification is split into two tracks:

**Track A (CSS):** Verify only the ROOT element of the instance:
- background-color, border-color, border-radius, height (bounding-box)
- **Do not verify** internal sub-elements (those are dart/Mantine internals, not our code)

**Track B (Props):** Code Review Agent reads CodeConnect snippets from `get_design_context`:
- Verify the correct dart component is used
- Verify correct props are passed

**Custom components:** full CSS verification (all rows)

**TEXT nodes:** font-size, line-height, color, font-weight, font-family

**Layout containers:** padding, gap, background-color

---

## 11. Auto-Named Frame Handling

Figma auto-named nodes fall into two categories:

| Category | Detection regex | Handling |
|----------|-----------------|----------|
| **A** — Frame NNNN / Group NNNN | `/^(Frame\|Group\|Rectangle\|Ellipse\|Vector)\s+\d+$/` | Skip the frame row itself; traverse children. Children use `meaningful-ancestor-testid + nth-child` as selector |
| **B** — hash names (e.g. `0223d75b4d0e048c9d8e`) | `/^[0-9a-f]{16,}\s+\d+$/` | Skip entirely including all children (Athena EHR elements — not our code) |

**Table selector strategy (Category A example):**
```
[data-testid="roi-table"] thead th:nth-child(N)
[data-testid="roi-table"] tbody tr:first-child td:nth-child(N)
```

---

## 12. UI State Setup (Prerequisites Block)

A single coverage map can cover **multiple UI states** within the same frame. Each row that belongs to an interactive state carries a `state` field and a `setupInteractions` array describing the exact click/input/keyboard sequence to reach that state before measuring.

```json
{
  "selector": "[class*='dropzone']",
  "state": "approve-dropzone",
  "setupInteractions": [
    { "action": "click", "selector": "input[value='approve']", "waitFor": "[class*='dropzone']" }
  ],
  "property": "display",
  "expected": "flex",
  "status": "pending"
}
```

**When to use separate files vs. per-row state:**
- **Per-row `setupInteractions` (preferred):** Different panels or sections within the same page that require a click or input to reveal. Default-state rows and interactive-state rows coexist in the same map.
- **Separate map files:** Truly separate pages (different URLs) or states that require a completely different `prerequisites.url`. Use a descriptive suffix: `coverage-map-<frameId>-<state-label>.json`.

The `prerequisites` block in the Coverage Map defines page-level required state before any rows are verified. Per-row `setupInteractions` handles UI interactions within that page.
- `url`: full URL including query params (ensures correct tab/filter state)
- `auth`: auth script path
- `waitFor`: wait condition (e.g. `tbody tr`)
- `viewport`: auto-inferred from Figma frame dimensions
- `stableCondition`: `network-idle` or custom selector
- `setupInteractions`: complex states (modal open, etc.) that require manual setup

**Auto-inference rules:**
- Drawer visible in Figma → ensure sidebar open
- Table rows exist → `waitFor: "tbody tr"`
- Frame width → viewport
- Hidden nodes → skip

**~80% auto-inferable; ~20% requires manual engineer input** (pixel-twin flags these during pre-flight)

---

## 13. Tolerance Rules

| Property | Tolerance |
|----------|-----------|
| color / background-color / border-color | Exact after hex→rgb conversion |
| rgba alpha | ±0.01 |
| font-size | Exact ±0px |
| font-weight | Exact ±0 |
| font-family | Contains match (actual must contain expected font name) |
| line-height | ±1px |
| padding / gap / margin | ±0.5px |
| border-radius | Exact |
| border-width | Exact |
| width / height (bounding-box) | ±1px |
| box-shadow | Parse → normalize → sort → exact per component |

**Rendering deltas (auto-accept, never block):**
- box-shadow blur ±1px
- sub-pixel gaps ≤0.5px
- font anti-aliasing

**Figma stale (not a FAIL):**
- actual = DartV1 ≠ Figma → PASS + log to figmaDiscrepancies

---

## 14. data-testid Convention

- Every semantically-named Figma layer → Implementation Agent adds `data-testid` (kebab-case of layer name)
- Auto-named wrappers → no testid; rely on ancestor + HTML structure for selector
- **Required, not optional.** Coverage Map selectors depend on testids.

---

## 15. Component Registry

`.claude/pixel-twin/component-registry.json`:

```json
{
  "209:11957": {
    "figmaName": "Frame 2608276",
    "type": "page",
    "filePath": "app/routes/list.tsx"
  },
  "14021": {
    "figmaName": "Filter Sidebar",
    "type": "component",
    "filePath": "client/features/RoiList/components/FilterSidebar.tsx",
    "parentFrame": "209:11957"
  }
}
```

**Lookup logic:**
1. Check registry → found → file path is known
2. Not in registry → grep codebase for data-testid → found → add to registry
3. Not found (new component) → pixel-twin asks one question: which route/feature? → store in registry

---

## 16. Upgrade Mode Diff Flow

Input: one page-level Figma URL (always only one URL needed)

1. Re-call `get_metadata` to get current Figma structure
2. Diff against existing Coverage Map, detect:
   - **Changed**: node-id is in registry, but Figma values have changed
   - **New**: node-id is not in registry
   - **Moved**: node-id is in registry, but parent has changed
3. Present diff summary and wait for confirmation:
   ```
   Detected changes:
     Changed  (3): FilterSidebar, StatusBadge, TableHeader
     New      (1): DueDateBadge
     Moved    (0): -
   Process all, or adjust scope?
   ```
4. After confirmation, process via sequential queue
5. Each component runs to completion (build rows → verify → fix → re-verify) before moving to the next

---

## 17. Development Philosophy: Outside-In (Both Modes)

Level 0 → 1 → 2 → 3; each level must pass verification before going deeper:

- **Level 0**: Page shell (layout, background, overall structure)
- **Level 1**: Major sections (sidebar, table container, header)
- **Level 2**: Components (filter inputs, table rows, badges)
- **Level 3**: Micro-details (icon sizes, text decorations, hover states)

---

## 18. Regression Check

Before starting a new frame, re-run computed-styles verification on all existing Coverage Maps:
- All rows re-verified against current browser state
- Any FAIL → fix first, then proceed to new frame
- Ensures no regressions from new changes

---

## 19. Verification Output Format

Visual Review Agent outputs a terminal summary:

```
PASS  20/23 properties
FAIL   3/23 properties:
  - [data-testid="filter-sidebar"]: background-color  expected rgb(255,255,255)  got rgb(248,248,248)
  - [data-testid="request-type"]: --input-size  expected 36px  got auto
  - [data-testid="roi-table"] thead th: font-weight  expected 400  got 600
FIGMA_CONFLICT  1 property (logged for designer, not blocking)
```

Full report written to `reports/<frameId>-report.md`.

---

## 20. Post-Spec Additions (v0.3.0 – v0.7.0)

These additions were made after the initial v2 spec was written. They are canonical — treat them as part of this spec.

### v0.3.0 — Figma-first Coverage Map building + screenshot comparison (2026-04-22)

- **`imagePixelColor` DOM metric** — canvas-based center-pixel sampling for `<img>` elements; returns `rgb(R,G,B)`, `"cross-origin"`, `"not-an-img"`, or `"not-loaded"`.
- **VRA Step 4c — Screenshot comparison** — after CSS verification, VRA takes a browser screenshot and diffs it against the stored Figma screenshot using `pixelmatch-compare.ts`. Thresholds: ≤1% pass, 1–5% warn, >5% fail.
- **Gate 7** — Orchestrator must call `get_screenshot` on every significant container during Step 3d-containers Phase 1; paths stored in `prerequisites.figmaScreenshots`.
- **Step 3d-containers: Figma-first two-phase structure** — Phase 1 collects all `get_design_context` + `get_screenshot` results into `figma-data-<frameId>.json`. Phase 2 reads only from that file when writing `expected` values. Never interleave.
- **Gate 6** — `expected` values must be traceable to `get_design_context` output. Every row must carry a `figmaSource` annotation.
- **VRA interactive state grouping** — per-row `state` + `setupInteractions` fields replace the old `verificationMethod: "interactive"` split.

### v0.4.0 — Bug fixes (2026-04-22)

- **IA must not update Coverage Map `status`/`actual`** — those fields are VRA-only. IA writing `"status": "pass"` makes VRA a no-op on re-runs. Hard rule added in implementation-agent.md Phase 7.
- **Mantine v8 `[data-value]` warning** — `Tabs.Tab` buttons in Mantine v8 do NOT render a `[data-value]` attribute. Use `[data-active]` instead.
- **`keepMounted` gotcha** — all Mantine tab panels remain in the DOM by default. `waitFor: "[data-testid='content']"` can match a hidden panel. Use `[data-state='active']` or a bounding-box check.
- **`--wait-for` runs AFTER `--interactions`** — documented in visual-review-agent.md.

### v0.5.0 — Mandatory Figma verification gates (2026-04-23)

- **Gate 8 — Figma citation block required before any CSS write** — every proposed fix must print a citation block before code is written:
  ```
  figma nodeId:  <id>
  figma says:    <value from get_design_context>
  DOM measured:  <actual>
  fix:           <what changes and why>
  ```
  If the block cannot be produced, the fix is blocked and the row is set to `needs-verify`.
- **Step 5d — mandatory Figma re-verification before dispatching Implementation Agent** — when VRA reports failures, the Orchestrator must call `get_design_context` on each failing row's `figmaNodeId` and print a citation block before looping back. If Figma returns a different value than Coverage Map `expected`, the map is corrected first.
- **Implementation Agent Phase 1 Step 0 (ITERATION > 1)** — call `get_design_context` for every FAIL row before root cause analysis. "The Coverage Map says X" is not valid — Figma is the only source of truth.

### v0.6.0 — Selector reliability + process hardening (2026-04-23)

- **`validate-coverage-map.ts`** — new script that dry-runs every CSS selector in a Coverage Map against the live DOM before VRA runs. Reports ✅ found / ⚠️ multiple / ❌ not-found. `--update` flag marks not-found rows as `needs-verify`. Exits 1 if any selector returns 0 elements.
- **Step 3h-validate** — Orchestrator must run `validate-coverage-map.ts` after writing the Coverage Map and before proceeding to Step 3i. No ❌ rows allowed before moving on.
- **`prerequisites.dataRequirements` field (required)** — Coverage Map prerequisites must include a description of the exact data state the URL must be in for all components to render correctly (e.g. "Use request 8252 — exception request required for exception badge to appear").
- **Phase 3a — Figma node → DOM element mapping table** — after reading the source file, Implementation Agent must produce an explicit table mapping each Figma node to its exact JSX element and DOM selector before writing any fix.
- **Step 3g — JSX-first selector assignment (Upgrade/Adopt Mode)** — selectors must be derived from reading actual source JSX, not guessed from Figma layer names. For each significant container, a Figma node → JSX element → CSS selector mapping must be stated before the selector is written to the Coverage Map.
- **Pseudo-element detection rule (Step 3e)** — when `get_design_context` shows `::after`/`::before` for visual effects, Coverage Map rows must target the parent's measurable properties instead of the pseudo-element.

### v0.7.0 — Selector re-validation on every VRA run + CSS property existence (2026-04-23)

- **Step 5a — selector re-validation before every VRA dispatch** — `validate-coverage-map.ts` now runs at the start of Step 5a on every run, not just at Coverage Map creation. Code changes between Coverage Map creation and the next VRA run can make selectors stale.
- **Phase 5 — CSS property existence rule** — before writing or keeping any CSS property (especially during token migrations), the agent must verify the property itself exists in Figma. "It was there before" is not a valid reason to keep a property. This applies to both token migrations (changing a value like `1.5rem` → `var(--mantine-spacing-md)`) and fix iterations.
