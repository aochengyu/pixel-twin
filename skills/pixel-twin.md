---
name: pixel-twin
description: Pixel-accurate UI implementation from Figma. Supports Build Mode (0→1 new UI) and Upgrade Mode (targeted fixes to existing UI). Uses a Coverage Map for systematic, measurable verification. Self-contained — depends only on Figma MCP, npx tsx scripts, and Claude Code's Agent tool.
---

# pixel-twin Orchestrator

You coordinate pixel-accurate UI implementation from Figma to browser. You build Coverage Maps, dispatch sequential sub-agents, and track per-component progress until every property passes.

**You do not write code. You do not review code. You direct, measure, and decide.**

---

## Dependencies (the only three you have)

- **Figma MCP**: `get_metadata`, `get_design_context`
- **Scripts**: `npx tsx <PIXEL_TWIN_ROOT>/scripts/*.ts`
- **Claude Code Agent tool**: spawn sub-agents by reading `skills/agents/*.md` and passing the content as the Agent prompt

`PIXEL_TWIN_ROOT` = the directory containing `skills/pixel-twin.md` minus the `skills/` segment — i.e. the root of the pixel-twin repo. Locate it at startup by finding where this skill file lives.

`PROJECT_ROOT` = `process.cwd()` when pixel-twin is invoked — the project being built or upgraded.

---

## Inputs

```
/pixel-twin <figma_url>
```

Parse `figma_url`:
- `fileKey`: from `/design/:fileKey/` in the URL
- `nodeId`: from `?node-id=X-Y` — convert `-` to `:`
- `frameId`: nodeId with `:` replaced by `-` (used as filename suffix)

If `figma_url` is missing, has no `node-id`, or resolves to the root canvas (`0:1`):
Call `get_metadata` with just the file key to list top-level frames. Print them and ask the user to select one.

---

## Step 0 — Check dev server

Send a GET to `http://localhost:5173`. Check `.claude/pixel-twin.config.ts` in `PROJECT_ROOT` for a custom port if it exists.

- 200 → already running, proceed
- Connection refused → print: `"Dev server is not running. Start it with \`npm run dev\` and try again."` then stop.

---

## Step 1 — Regression check

Before any new work, check for existing Coverage Maps:

```
PROJECT_ROOT/.claude/pixel-twin/coverage-map-*.json
```

If any exist (for frames other than the current one), spawn a Visual Review Agent on each to confirm no regressions. If failures found — fix them first via an Implementation Agent cycle, then proceed.

If no existing Coverage Maps: skip this step.

---

## Step 2 — Mode detection

Check whether `PROJECT_ROOT/.claude/pixel-twin/coverage-map-<frameId>.json` exists.

- **Does not exist** → **Build Mode** → go to Step 3
- **Exists** → **Upgrade Mode** → go to Step 4

---

## Step 3 — Build Mode: Coverage Map Builder

### 3a — Fetch node tree

Call `get_metadata` with `fileKey` and `nodeId`. Record the full node tree.

### 3b — Filter auto-named nodes

Apply these rules to every node in the tree:

| Pattern | Rule |
|---------|------|
| Name matches `/^[0-9a-f]{16,}(\s+\d+)?$/` | **Category B** — skip entirely, including all children (third-party EHR elements) |
| Name matches `/^(Frame\|Group\|Rectangle\|Ellipse\|Vector)\s+\d+$/` | **Category A** — skip this node's own row, but traverse its children |

### 3c — Identify significant containers

From the remaining named nodes, select ~4–6 **significant containers**: nodes that have a semantic name and group a recognizable UI section. Not the root frame. Not leaf text or icons.

Examples: `Filter Sidebar`, `Table Header`, `Status Badge`.
Not significant: `Filter Label`, `chevron-icon`, `Frame 7`.

### 3d — Call get_design_context

Call `get_design_context` on each significant container (`nodeId` + `fileKey`).

### 3e — Value Extractor

From each response, extract CSS property values. Responses contain Tailwind classes with values in the pattern `var(--token-name, fallback)`.

For each CSS property:
1. `var(--token, fallback)` → record `figmaValue = fallback`, `cssVar = --token`
2. Raw hex/px (no token) → record `figmaValue = value`, `cssVar = null`

Properties to extract by element type:
- **Layout containers**: `background-color`, `padding-top/right/bottom/left`, `gap`, `border-radius`, `border-color`, `border-width`
- **TEXT nodes**: `font-size`, `line-height`, `font-weight`, `color`, `font-family`
- **dart/Mantine INSTANCE root only**: `background-color`, `border-color`, `border-radius`, `height`
- **Custom components**: all of the above

### 3f — CSS Variable Extraction

For every unique `cssVar` collected in 3e, run once per URL:

```bash
npx tsx <PIXEL_TWIN_ROOT>/scripts/css-variables.ts \
  --url "<app URL from prerequisites>" \
  --vars "<comma-separated cssVar names>" \
  --wait-for "body" \
  [--auth-helper "<auth script path>"]
```

Record the resolved value as `dartV1Value` for each row.

**Three-way comparison rule:**
- `figmaValue` ≠ `dartV1Value` → `figmaConflict: true` (Figma is stale; Dart V1 is correct)
- `expected = dartV1Value` always (source of truth)
- If `cssVar = null`: `expected = figmaValue` (no token — Figma value is authoritative)

### 3g — Assign selectors

For each property row, assign a selector using this priority:

1. `[data-testid="<kebab-case-of-figma-layer-name>"]` (preferred)
2. `[data-testid="<meaningful-ancestor>"] <nth-child path>` (for table cells)
3. HTML semantic path (`thead th:nth-child(N)`, `tbody tr:first-child td:nth-child(N)`)

For Category A parent nodes (auto-named): the children use `meaningful-ancestor-testid + positional path` as their selector.

If data-testid does not yet exist (Build Mode), record the intended testid value — Implementation Agent will add it to the code.

### 3h — Write Coverage Map

Create `PROJECT_ROOT/.claude/pixel-twin/coverage-map-<frameId>.json`:

```json
{
  "frameId": "<frameId>",
  "figmaUrl": "<original figma_url>",
  "lastVerified": null,
  "prerequisites": {
    "url": "<inferred app URL>",
    "auth": "<path to auth helper, or null>",
    "waitFor": "<inferred — e.g. 'tbody tr' if table rows visible>",
    "viewport": { "width": <frame width>, "height": <frame height> },
    "stableCondition": "networkidle",
    "setupInteractions": []
  },
  "rows": [
    {
      "selector": "<CSS selector>",
      "figmaNodeId": "<nodeId of the Figma layer>",
      "property": "<css-property>",
      "figmaValue": "<value from Figma>",
      "dartV1Value": "<resolved token value, or same as figmaValue if no token>",
      "cssVar": "<--token-name or null>",
      "figmaConflict": false,
      "expected": "<dartV1Value>",
      "actual": null,
      "status": "pending",
      "tolerance": "<tolerance-key>"
    }
  ],
  "figmaDiscrepancies": []
}
```

**Prerequisites auto-inference:**
- Table rows visible in Figma frame → `waitFor: "tbody tr"`
- Frame dimensions → `viewport`
- Sidebar visible → note in `setupInteractions`: auto-inferred as open by default
- Any field you cannot infer → leave `null` and print: `"⚠️ prerequisites.<field> is null — fill before running verification"`

Pause if any prerequisite field is null. Ask the engineer to supply the value before continuing.

**Tolerance key reference:**

| Key | When to use |
|-----|-------------|
| `exact-after-hex-rgb` | `color`, `background-color`, `border-color` |
| `alpha-0.01` | rgba alpha channel (±0.01) |
| `exact-px` | `font-size`, `font-weight`, `border-radius`, `border-width` |
| `plus-minus-1px` | `line-height`, `width`, `height` (bounding-box) |
| `plus-minus-0.5px` | `padding`, `gap`, `margin` |
| `box-shadow-normalized` | `box-shadow` |
| `font-family-contains` | `font-family` |

### 3i — Initialize component registry

Create `PROJECT_ROOT/.claude/pixel-twin/component-registry.json`:

```json
{
  "<nodeId>": {
    "figmaName": "<Figma layer name>",
    "type": "page",
    "filePath": "<inferred route file, e.g. app/routes/list.tsx, or null>",
    "parentFrame": null
  }
}
```

Add entries for each significant container with `type: "component"` and `parentFrame: "<frameId>"`. Leave `filePath` null if unknown — Implementation Agent will fill it in.

Print summary:
```
[pixel-twin] Coverage Map built — <N> rows across <M> components
[pixel-twin] Components queued: <list>
```

Then build a queue file and go to Step 5.

---

## Step 4 — Upgrade Mode: Diff

### 4a — Fetch current Figma state

Call `get_metadata` with `fileKey` and `nodeId`. Get the current node tree.

### 4b — Compare to existing Coverage Map

Read `coverage-map-<frameId>.json`. For each significant container (nodes that were significant containers during the original build):

1. **Changed**: call `get_design_context` and compare returned values to `figmaValue` fields in Coverage Map rows — if different, it's Changed
2. **New**: node-id not in any Coverage Map row and not in component-registry
3. **Moved**: node-id in registry but has a different parent in current Figma tree

To minimize Figma API calls, only call `get_design_context` on significant containers (4–6 nodes), not every leaf.

### 4c — Present diff and wait

```
[pixel-twin] Upgrade Mode — diff vs Coverage Map:
  Changed  (N): <component names>
  New      (N): <component names>
  Moved    (N): <component names or "none">

Process all, or specify which to skip?
```

Wait for engineer confirmation before proceeding.

### 4d — Write queue

Create `PROJECT_ROOT/.claude/pixel-twin/queue-<frameId>.json`:

```json
{
  "frameId": "<frameId>",
  "mode": "upgrade",
  "pendingComponents": [
    { "nodeId": "<id>", "figmaName": "<name>", "reason": "changed|new|moved" }
  ],
  "completedComponents": []
}
```

Then go to Step 5.

---

## Step 5 — Component queue loop

Read the queue file. Process each `pendingComponents` entry **sequentially** — never start the next component before the current one is complete.

For each component (`nodeId`, `figmaName`), run one iteration cycle:

### 5a — Spawn Implementation Agent

Read `PIXEL_TWIN_ROOT/skills/agents/implementation-agent.md`. Spawn an Agent with:
- **model**: `claude-opus-4-6`
- **prompt**: the full content of `implementation-agent.md` + the inputs block below

```
COVERAGE_MAP_PATH: PROJECT_ROOT/.claude/pixel-twin/coverage-map-<frameId>.json
COMPONENT_REGISTRY_PATH: PROJECT_ROOT/.claude/pixel-twin/component-registry.json
PROJECT_ROOT: <absolute path>
PIXEL_TWIN_ROOT: <absolute path>
COMPONENT_NODE_ID: <nodeId>
FIGMA_FILE_KEY: <fileKey>
MODE: build | upgrade
ITERATION: <1 on first run, 2+ on retry>
PREVIOUS_REVIEW_PATH: <path to review-result-<nodeId>.json if iteration > 1, else null>
```

Print: `[pixel-twin] [N/TOTAL] <figmaName> — implementing... (iter <I>)`

Wait for agent. Check that `PROJECT_ROOT/.claude/pixel-twin/impl-result-<nodeId>.json` exists.

### 5b — Spawn Visual Review Agent

Read `PIXEL_TWIN_ROOT/skills/agents/visual-review-agent.md`. Spawn an Agent with:
- **model**: `claude-sonnet-4-6`
- **prompt**: full content of `visual-review-agent.md` + inputs:

```
COVERAGE_MAP_PATH: PROJECT_ROOT/.claude/pixel-twin/coverage-map-<frameId>.json
PROJECT_ROOT: <absolute path>
PIXEL_TWIN_ROOT: <absolute path>
COMPONENT_NODE_ID: <nodeId>
```

Print: `[pixel-twin] [N/TOTAL] <figmaName> — verifying...`

Wait for agent. Read `PROJECT_ROOT/.claude/pixel-twin/review-result-<nodeId>.json`.

### 5c — Spawn Code Review Agent

Read `PIXEL_TWIN_ROOT/skills/agents/code-review-agent.md`. Spawn an Agent with:
- **model**: `claude-haiku-4-5-20251001`
- **prompt**: full content of `code-review-agent.md` + inputs:

```
PROJECT_ROOT: <absolute path>
CHANGED_FILES: <from impl-result-<nodeId>.json .filesChanged>
FIGMA_FILE_KEY: <fileKey>
COMPONENT_NODE_ID: <nodeId>
PIXEL_TWIN_ROOT: <absolute path>
COMMANDS:
  typecheck: npm run typecheck
  lint: npm run lint
  test: npm run test
DESIGN_SYSTEM: @datavant/dart
SAFETY_PROFILE: datavant-hipaa
CONVENTION_PROFILE: datavant
```

Print: `[pixel-twin] [N/TOTAL] <figmaName> — code review...`

Wait for agent. Read `PROJECT_ROOT/.claude/pixel-twin/code-result-<nodeId>.json`.

If code review `hasBlockers: true`: upgrade model to `claude-sonnet-4-6` and re-run code review once before treating as a blocker.

### 5d — Evaluate

Read `review-result-<nodeId>.json` and `code-result-<nodeId>.json`.

**All pass** (`failCount == 0`, code `hasBlockers == false`):
```
[pixel-twin] [N/TOTAL] <figmaName> — ✅ PASS (X/Y properties)
```
Update queue: move from `pendingComponents` to `completedComponents`. Write queue file. Proceed to next component.

**Has failures** (iteration 1–4):

Print:
```
[pixel-twin] [N/TOTAL] <figmaName> — ❌ iteration <I>/4
  CSS failures (<K>):
    - <selector>: <property>  expected <X>  got <Y>
  Code blockers (<M>):
    - <file>:<line> — <issue>
```

Loop back to Step 5a for this component with `ITERATION` incremented and `PREVIOUS_REVIEW_PATH` set.

**Iteration 5** (stuck — escalate):
```
[pixel-twin] [N/TOTAL] <figmaName> — 🔴 STUCK after 4 iterations

Remaining CSS failures:
  <list>
Remaining code blockers:
  <list>

Options:
  A. Provide a hint or context and retry
  B. Skip this component for now
```
Wait for engineer response before proceeding.

**Only `figma_conflict` rows** (no `fail` rows):
Log conflicts to `figmaDiscrepancies` in the Coverage Map and proceed — these are Figma inconsistencies, not code bugs. Designer should be notified separately.

---

## Step 6 — Final sign-off

After all components in the queue are done:

```
[pixel-twin] Complete.
  ✅ Passed:  <list>
  🔴 Stuck:   <list, if any>
  ⚠️  Figma inconsistencies (flagged for designer): <list, if any>

No git changes made. Review the diff and commit when ready.
```
