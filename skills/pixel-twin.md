---
name: pixel-twin
description: Pixel-accurate UI implementation from Figma. Supports Build Mode (0→1 new UI) and Upgrade Mode (targeted fixes to existing UI). Uses a Coverage Map for systematic, measurable verification. Self-contained — depends only on Figma MCP, npx tsx scripts, and Claude Code's Agent tool.
---

# pixel-twin Orchestrator

You coordinate pixel-accurate UI implementation from Figma to browser. You build Coverage Maps, dispatch sequential sub-agents, and track per-component progress until every property passes.

**You do not write code. You do not review code. You direct, measure, and decide.**

---

## ⛔ MANDATORY GATES — check before each phase transition

| # | Gate | Fail consequence |
|---|------|-----------------|
| 1 | `coverage-map-<frameId>.json` written to disk BEFORE any `computed-styles.ts` run | Spot-checks miss issues — confirmation bias |
| 2 | Every named text element has rows for ALL of: `font-size`, `font-weight`, `line-height`, `color`, `text-align` | Typography bugs invisible |
| 3 | Every named sub-component got its own `get_design_context` call (not just the parent container) | Wrong values in Coverage Map rows |
| 4 | Every `clarification.uiStates` entry has Coverage Map rows WITH `setupInteractions` populated | Interactive states never checked |
| 5 | Every significant container + dart instance root has `boundingWidth` + `boundingHeight` rows | Layout cascade bugs invisible |
| 6 | Every `expected` value is sourced from `get_design_context` output — NEVER from code knowledge, screenshots, or "visually looks correct" reasoning | Cognitive bias: rows pass because you wrote what the code already does, not what Figma specifies |
| 7 | `get_screenshot` called on every significant container during Step 3d-containers Phase 1; screenshot paths stored in `prerequisites.figmaScreenshots` | Visual regressions in icon shape, SVG paths, or rendering artifacts that CSS properties cannot detect go unnoticed |
| 8 | Every proposed CSS fix MUST be accompanied by a printed Figma citation block (see format below) before any code is written | Engineer cannot verify the fix is targeting the right value; silent Gate 6 violations go undetected |

**Figma citation block format** (mandatory output before any CSS write):
```
[pixel-twin] Figma citation — <selector> / <property>
  figma nodeId:  <id>
  figma says:    <value>  (from get_design_context)
  DOM measured:  <actual>
  fix:           <what changes and why>
```

If this block cannot be produced (no `get_design_context` response for the node): do not write the fix. Set the row to `status: "needs-verify"` and report to engineer.

---

## Dependencies (the only four you have)

- **Figma MCP**: `get_metadata`, `get_design_context`
- **Scripts**: `npx tsx <PIXEL_TWIN_ROOT>/scripts/*.ts`
  - `computed-styles.ts` — measure CSS properties from live DOM
  - `css-variables.ts` — resolve CSS token values
  - `validate-coverage-map.ts` — dry-run all Coverage Map selectors against live DOM before VRA
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

## ⚡ FIRST OUTPUT — Print before any tool call

The absolute first thing you do — before reading config, before checking the server, before everything:

```
[pixel-twin] Starting — parsing Figma URL
```

Then proceed immediately to Step 0a. Print progress at each sub-step so the user always knows what is happening.

---

## Step 0 — Load config and check dev server

### 0a — Read project config

Print: `[pixel-twin] Reading config...`

Read `PROJECT_ROOT/.claude/pixel-twin.config.ts` and extract all fields. If the file does not exist, use these defaults:

```
port:                        3000
srcDir:                      "."
designSystem:                null
designSystemKnowledgePath:   null
safetyProfile:               "none"
conventionProfile:           "none"
auth:                        null
phiSanitizationFunctions:   []
```

Store these values — every subsequent step that passes config to a sub-agent reads from here.

**Auth resolution**: if `config.auth` is non-null, resolve it to an absolute path: `PROJECT_ROOT/<config.auth>`. This is the `AUTH_HELPER_PATH` used by all agents and scripts.

**Design system knowledge resolution**: if `config.designSystemKnowledgePath` is non-null, resolve it to an absolute path: `PIXEL_TWIN_ROOT/<config.designSystemKnowledgePath>`. This is `DESIGN_SYSTEM_KNOWLEDGE_PATH`.

### 0b — Check dev server

Print: `[pixel-twin] Checking dev server at http://localhost:<port>...`

Send a GET to `http://localhost:<config.port>`.

- 200 → print `[pixel-twin] Dev server OK` and proceed
- Connection refused → print: `"Dev server is not running. Start it (e.g. \`npm run dev\`) then try again."` and stop.

### 0c — Pre-flight clarification

**⛔ STOP HERE. Do NOT proceed to Step 0d until the user has replied.** Ask all four in one message:

1. **UI states** — interactive states needing separate measurement? list + how to trigger each
2. **Auth** — login required? auth helper in `.claude/pixel-twin.config.ts`? which file?
3. **Dynamic data** — data-dependent rendering? MSW/fixture to use? deterministic state?
4. **Exclusions** — components to skip? (third-party, animated, random-value elements)

Record: `clarification.{uiStates, authRequired, fixtureNote, exclusions}`. Use throughout: Step 3 row generation, Coverage Map `prerequisites.setupInteractions`, and agent auth path.

### 0d — Regression check

Print: `[pixel-twin] Checking for regressions in existing Coverage Maps...`

Scan for existing Coverage Maps:

```
PROJECT_ROOT/.claude/pixel-twin/coverage-map-*.json
```

If none exist: print `[pixel-twin] No existing Coverage Maps — skipping regression check.` and proceed.

If any exist (for frames other than the current one), spawn a Visual Review Agent on each to confirm no regressions:

```
COVERAGE_MAP_PATH: <path to the existing coverage map>
PROJECT_ROOT: <absolute path>
PIXEL_TWIN_ROOT: <absolute path>
COMPONENT_NODE_ID: "*"   ← special value: check ALL rows in the map
```

Print: `[pixel-twin] Regression check: <N> map(s) to verify...`

If failures found — fix them first via an Implementation Agent cycle, then proceed.

---

## Step 2 — Mode detection

Check whether `PROJECT_ROOT/.claude/pixel-twin/coverage-map-<frameId>.json` exists.

- **Does not exist** → ask: "Does this frame already have working code, or is it net-new?"
  - **Net-new (0→1)** → **Build Mode** → go to Step 3
  - **Existing code, just needs coverage** → **Adopt Mode** → go to Step 2a
- **Exists** → **Upgrade Mode** → go to Step 4

---

## Step 2a — Adopt Mode: baseline from current DOM

Skips Figma API and Implementation Agent. Use when existing code is correct and you only need regression prevention.

1. **Identify selectors** — grep `data-testid` in the component directory or read `COMPONENT_REGISTRY_PATH`
2. **Measure current DOM** — run `computed-styles.ts --batch` with the mandatory property set per element type (see dart-knowledge.md Coverage Map Property Matrix)
3. **Write map** — use measured values as `expected`, `status: "pass"`, `figmaValue: null`
4. **Verify** — run Visual Review Agent; if failures, fix selectors/properties first

Print: `[pixel-twin] Adopt Mode complete — <N> rows for <frameId>. Baseline locked.` → go to Step 6.

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

### 3b-dart — Identify dart/Mantine component instances (auto-detection)

A node is a dart/Mantine instance if its name (or `componentProperties.mainComponent.name`) matches a known component name (case-insensitive, partial match). See `PIXEL_TWIN_ROOT/skills/agents/dart-knowledge.md` section **Known dart v1 Components** for the full name list.

If uncertain: call `get_design_context` on the node — if the snippet shows `import { X } from "@datavant/dart"` → it's a dart instance.

**For dart instances:**
- Use the **dart/Mantine INSTANCE ROOT** property matrix (see dart-knowledge.md)
- Implementation Agent uses dart props, not CSS overrides on internals
- Do NOT traverse children — instance root is the verification boundary

**For non-instances:** classify normally (layout container, text node, SVG)

---

### 3c — Identify significant containers and assign outside-in levels

From the remaining named nodes, select ~4–6 **significant containers**: nodes that have a semantic name and group a recognizable UI section. Not the root frame. Not leaf text or icons.

Examples: `Filter Sidebar`, `Table Header`, `Status Badge`.
Not significant: `Filter Label`, `chevron-icon`, `Frame 7`.

**Assign an outside-in level to each container:**

| Level | What it covers | Examples |
|-------|---------------|---------|
| 0 | Page shell — the outermost layout, background, overall structure | Root page wrapper, page-level flex/grid container |
| 1 | Major sections — direct children of the page shell that group large UI regions | Sidebar, Table container, Header bar |
| 2 | Components — meaningful UI units within sections | Filter inputs, table rows, pagination bar, individual badges |
| 3 | Micro-details — leaf-level visual details within components | Icon sizes, text decorations, hover states |

The queue must be ordered by level. Level 0 is processed and must fully pass before Level 1 starts. Level 1 must fully pass before Level 2. A stuck component at level N blocks all components at level N+1 and deeper — escalate to engineer before proceeding.

### 3d — Structural Reading Phase (mandatory — do this before writing any code)

**Call `get_design_context` on the TARGET FRAME NODE** (the root frame, not just containers). Extract:

1. **Direct children of the frame in document order** (top-to-bottom as they appear in the frame):
   - Name, nodeId, and type of each child
   - Whether it is a container (has children) or a leaf

2. **For each container child**: extract its direct children the same way.

3. **Map every Figma node to its code equivalent** before writing any code (table: Figma name | nodeId | selector).

4. **Write structural entries in the Coverage Map** `rows` array — one row per containment relationship that matters:

```json
{
  "figmaNodeId": "<id>",
  "figmaName": "<name>",
  "selector": "<expected code selector>",
  "property": "structure",
  "figmaValue": "<parent>: [<child1>, <child2>, ...]",
  "expected": "<parent>: [<child1>, <child2>, ...]",
  "tolerance": "structural",
  "status": "pending"
}
```

**Do not proceed to Step 3d-container (significant containers) until this structural map is complete.** If any containment relationship is ambiguous, call `get_design_context` on the ambiguous node to clarify before implementing.

### 3d-containers — Figma data collection phase (MANDATORY — complete before writing any rows)

**⛔ This is a two-phase step. Phase 1 collects ALL Figma data. Phase 2 writes rows. NEVER interleave them.**

#### Phase 1 — Collect Figma data

Call `get_design_context` on each significant container (`nodeId` + `fileKey`).

**Sub-component drilling (mandatory — this is Gate 3):**
After receiving the `get_design_context` response for a container, examine its children. For every child node that is:
- A text node with a non-auto name (any node whose Figma layer name is not "Text", "Label", "Frame N", etc.)
- An interactive element (Radio, Checkbox, Button variant, input field)
- A named child container with semantic meaning (Dropzone, File Upload Area, Warning Banner)

Call `get_design_context` on that child's **specific nodeId**. Do not skip any named child.

**Also capture Figma screenshots during Phase 1:** For each significant container's `nodeId`, call `get_screenshot` (Figma MCP) and save the result to:
```
PROJECT_ROOT/.claude/pixel-twin/screenshots/figma-<nodeId>.png
```
Store the screenshot's `width` and `height` in `figmaScreenshotMeta` inside the temp file (below).

**Write all collected responses to a temp file — do not write Coverage Map rows yet:**

```
PROJECT_ROOT/.claude/pixel-twin/figma-data-<frameId>.json
```

Structure:
```json
{
  "<nodeId>": {
    "figmaName": "<layer name>",
    "designContextResponse": "<full get_design_context response>",
    "screenshotPath": ".claude/pixel-twin/screenshots/figma-<nodeId>.png",
    "screenshotWidth": 320,
    "screenshotHeight": 480
  }
}
```

**Gate 6 enforcement:** You may NOT write `expected` values to Coverage Map rows until `figma-data-<frameId>.json` is written and contains an entry for every significant container and its named children. If you do not have a `get_design_context` response for a node, set `expected: null` and `status: "needs-verify"`.

#### Phase 2 — Write Coverage Map rows

Only after `figma-data-<frameId>.json` is complete, read it back and use its data as the ONLY source for `expected` values. For each row, set `"figmaSource": "get_design_context nodeId <id>"` to document which Figma call supplied the value.

### 3e — Value Extractor

From each response, extract CSS property values. Responses contain Tailwind classes with values in the pattern `var(--token-name, fallback)`.

For each CSS property:
1. `var(--token, fallback)` → record `figmaValue = fallback`, `cssVar = --token`
2. Raw hex/px (no token) → record `figmaValue = value`, `cssVar = null`

Extract properties **outside-in: container layout first, then visual, then children.**

**Why layout-first**: layout property bugs (wrong `flex-direction`, `min-height: 100%`, `overflow: hidden`) corrupt entire subtrees. Container layout must be verified before checking child properties.

**Property extraction tables by element type** — see `PIXEL_TWIN_ROOT/skills/agents/dart-knowledge.md`, section **Coverage Map Property Matrix**. That section defines the mandatory base set for LAYOUT CONTAINERS, TEXT NODES, dart/Mantine INSTANCE ROOT, and SVG/ICON ELEMENTS, plus tolerance keys and bounding-box rules.

Every element type has a mandatory base set — extract these regardless of whether Figma explicitly shows the value. Absent Figma values still affect rendering via browser defaults and library resets.

**⛔ GATE 6 enforcement — mandatory for every Coverage Map row:**

Before writing any row's `expected` value, you MUST have called `get_design_context` on that node (or its nearest named ancestor). The `expected` value MUST come from the `get_design_context` response — either the CSS value in the returned code snippet, or the computed fallback from a `var(--token, fallback)` pattern.

**NEVER write `expected` from:**
- Code you've already written ("the code sets `color: #020202`, so expected is `#020202`")
- Screenshots or DevTools readings
- Token names alone without resolving the value (e.g. writing `expected: "--text-on-base-default"` without the resolved hex)
- "It looks correct visually"
- Tabler icon default stroke colors (always call `get_design_context` on the icon node first)

**For each row you write, record the source in a `figmaSource` annotation** (this field is informational and not checked by VRA):
- `"figmaSource": "get_design_context nodeId 40:12458"` — direct Figma call
- `"figmaSource": "inferred from parent container 40:12390"` — derived from parent (acceptable only for structural/layout rows with no matching leaf node)
- `"figmaSource": "dartV1Value resolved from CSS variable"` — for rows where `cssVar` is non-null and `dartV1Value` was set from `css-variables.ts`

If you cannot call `get_design_context` (no network, tool error): set `expected: null` and `status: "needs-verify"`. DO NOT guess.

**⛔ Pseudo-element detection rule:**

If `get_design_context` returns CSS that implements a visual effect via `::after` or `::before` (common patterns: underline indicators, overlays, decorative borders), do NOT write Coverage Map rows for the pseudo-element's properties — `computed-styles.ts` cannot measure them.

Instead:
1. Write rows for the **parent element's measurable properties** that are prerequisites for the pseudo-element to work: `position` (must be `relative`), `z-index` (if stacking matters)
2. Add a `note` field explaining the visual effect is via `::after`/`::before`
3. The `expected` for `border-bottom-width` on the parent should be `"0px"` (or `"none"`) if the visual border is on the pseudo-element, not the element itself

Example (tab active indicator via `::after`):
```json
{
  "selector": ".mantine-Tabs-tab[data-active]",
  "property": "border-bottom-width",
  "expected": "0px",
  "note": "Visual blue indicator implemented via ::after{height:1.5px}; element border is none"
}
```

This prevents the mistake of writing `expected: "1.5px"` for a property that will always measure `0px`.

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

**⛔ Upgrade Mode / Adopt Mode — read JSX before assigning selectors:**

In Build Mode, no source file exists yet, so selectors are assigned from Figma node names. In Upgrade and Adopt Mode, the component already exists — selectors MUST be derived from the actual DOM structure, not guessed from Figma layer names.

For each significant container in Upgrade/Adopt Mode:
1. Locate the source file (grep for the component name or known `data-testid`)
2. Read the JSX
3. For every Figma node being assigned a selector, state explicitly:
   ```
   Figma node "<name>" → JSX: <element type and key props> → selector: <CSS selector>
   Sub-elements note: <any children with different styling than the parent>
   ```
4. Only after this mapping is written: assign the selector to the Coverage Map row

Selectors written without reading the JSX are guesses. Guessed selectors are the primary cause of stale selector failures and wrong-element targeting.

### 3h — Write Coverage Map

Write `PROJECT_ROOT/.claude/pixel-twin/coverage-map-<frameId>.json`. Required top-level fields: `frameId`, `figmaUrl`, `lastVerified: null`, `figmaDiscrepancies: []`, and a `prerequisites` block with:

| Field | Value |
|---|---|
| `url` | inferred app URL |
| `auth` | auth helper path or null |
| `waitFor` | key selector (e.g. `"tbody tr"`) |
| `viewport` | from Figma frame dimensions |
| `stableCondition` | `"networkidle"` |
| `setupInteractions` | `[]` (filled when interactive states are added) |
| `figmaScreenshots` | map of `nodeId → { path, width, height }` from Step 3d-containers Phase 1 |
| `dataRequirements` | **required** — describe what data state the URL must be in for every component in this frame to render correctly. If any component only appears with specific data (e.g. exception badge only shows on exception requests, empty state only shows when list is empty), name the exact URL and why. Example: `"Use request 8252 — practice_certification_needed exception. Non-exception requests will not render the exception badge."` If the frame has no data-dependent states, write `"none"`. |

Each row: `{ selector, figmaNodeId, property, figmaValue, dartV1Value, cssVar, figmaConflict: false, expected, actual: null, status: "pending", tolerance }`.

If any prerequisite cannot be inferred, leave `null` and stop: `"⚠️ prerequisites.<field> is null — fill before running verification"`.

Tolerance keys are in dart-knowledge.md → **Coverage Map Property Matrix → Tolerance key reference**.

**Completeness self-check (mandatory before Step 5) — check all 4 Gates:**

Run the Gate checks (Gates 2–5). Print `[pixel-twin] Coverage Map self-check: text N/M, bbox N/M, states N/M, sub-components N/M`. Fix any ratio that is not N/N before proceeding.

### 3h-validate — Selector dry-run (mandatory before Step 3i)

After writing the Coverage Map and passing the self-check, run:

```bash
npx tsx <PIXEL_TWIN_ROOT>/scripts/validate-coverage-map.ts \
  --coverage-map <coverage-map-path> \
  [--auth-helper "<AUTH_HELPER_PATH>"]
```

Print the output. For each `❌ not-found` selector:
1. Re-read the source JSX to find the correct selector
2. Update the Coverage Map row's `selector` field
3. Re-run `validate-coverage-map.ts` until all selectors are `✅` or `⚠️`

For `⚠️ multiple` results: verify the selector targets the intended element (not a sibling or ancestor). Tighten the selector if it could match the wrong element.

**Do not proceed to Step 3i until `validate-coverage-map.ts` exits 0 (no `❌` rows).**

### 3i — Initialize state files

Create `component-registry.json`: `{ "<nodeId>": { figmaName, type: "component"|"page", filePath: null, parentFrame } }`. Leave `filePath` null — Implementation Agent fills it in.

Create `queue-<frameId>.json`: `{ frameId, mode: "build", currentLevel: 0, pendingComponents: [{ nodeId, figmaName, reason: "new", level }], completedComponents: [] }`. Sort `pendingComponents` by `level` ascending.

Create `reports/` directory.

Print: `[pixel-twin] Coverage Map built — <N> rows across <M> components. Queued: <list>`

Then go to Step 5.

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

Write `queue-<frameId>.json`: `{ frameId, mode: "upgrade", pendingComponents: [{ nodeId, figmaName, reason: "changed"|"new"|"moved" }], completedComponents: [] }`. Then go to Step 5.

---

## Step 5 — Component queue loop (outside-in, level by level)

Read the queue file. Process components **strictly by level** — never start a component at level N+1 until every component at level N has `status: "pass"` in the Coverage Map.

Filter `pendingComponents` to `level == currentLevel`, run sequentially, only increment level after all pass. STUCK at iteration 5 → wait for engineer before advancing. Never start deeper levels on a broken foundation.

For each component (`nodeId`, `figmaName`), run one iteration cycle:

### 5a — Gate check

Confirm `coverage-map-<frameId>.json` exists, has non-zero rows, and self-check from Step 3h passed. If missing: return to Step 3. Never implement without a Coverage Map.

**Selector re-validation (mandatory on every run, not just Coverage Map creation):**

Run `validate-coverage-map.ts` now, even if the Coverage Map was validated in Step 3h-validate. Code changes between Coverage Map creation and this run may have made selectors stale.

```bash
npx tsx <PIXEL_TWIN_ROOT>/scripts/validate-coverage-map.ts \
  --coverage-map <coverage-map-path> \
  [--auth-helper "<AUTH_HELPER_PATH>"]
```

- `❌ not-found`: fix the selector before dispatching any agent. Do NOT proceed with a Coverage Map that has unresolvable selectors — VRA will measure `null` and the iteration is wasted.
- `⚠️ multiple`: verify by hand which element is the intended target; tighten the selector if ambiguous.
- All `✅`: proceed.

**Agent spawn pattern** (applies to 5a-impl, 5b, 5c): Read the agent md file → `Agent(model: X, prompt: file content + inputs block)`.

### 5a-impl — Implementation Agent (`claude-opus-4-7`, file: `implementation-agent.md`)

```
COVERAGE_MAP_PATH:            PROJECT_ROOT/.claude/pixel-twin/coverage-map-<frameId>.json
COMPONENT_REGISTRY_PATH:      PROJECT_ROOT/.claude/pixel-twin/component-registry.json
PROJECT_ROOT:                 <absolute path>
PIXEL_TWIN_ROOT:              <absolute path>
COMPONENT_NODE_ID:            <nodeId>
FIGMA_FILE_KEY:               <fileKey>
MODE:                         build | upgrade
ITERATION:                    <1 on first run, 2+ on retry>
PREVIOUS_REVIEW_PATH:         <path to review-result-<nodeId>.json if iteration > 1, else null>
SRC_DIR:                      <config.srcDir>
DESIGN_SYSTEM:                <config.designSystem>
DESIGN_SYSTEM_KNOWLEDGE_PATH: <DESIGN_SYSTEM_KNOWLEDGE_PATH resolved in Step 0a, or null>
```

Print: `[pixel-twin] [N/TOTAL] <figmaName> — implementing... (iter <I>)`

Wait for agent. Check that `PROJECT_ROOT/.claude/pixel-twin/impl-result-<nodeId>.json` exists.

### 5b — Visual Review Agent (`claude-sonnet-4-6`, file: `visual-review-agent.md`)

```
COVERAGE_MAP_PATH:  PROJECT_ROOT/.claude/pixel-twin/coverage-map-<frameId>.json
PROJECT_ROOT:       <absolute path>
PIXEL_TWIN_ROOT:    <absolute path>
COMPONENT_NODE_ID:  <nodeId>
AUTH_HELPER_PATH:   <AUTH_HELPER_PATH resolved in Step 0a, or null>
```

Print: `[pixel-twin] [N/TOTAL] <figmaName> — verifying...`

**⚡ REAL-TIME PROGRESS (mandatory — do not batch all rows at once)**

Instead of running all Coverage Map rows in a single computed-styles.ts call, split them into groups of **10–12 rows** and output a progress line after each group:

```
[pixel-twin] measuring... 12/44 rows  ███░░░░░░░░░░░░░░░░░  27%  pass:11  fail:1  pending:0
[pixel-twin] measuring... 24/44 rows  ██████░░░░░░░░░░░░░░  55%  pass:23  fail:1  pending:0
[pixel-twin] measuring... 36/44 rows  █████████░░░░░░░░░░░  82%  pass:35  fail:1  pending:0
[pixel-twin] measuring... 44/44 rows  ████████████████████  100%  pass:43  fail:1  pending:0
```

**How to split:**
1. Read all rows from the coverage map for this component
2. Group into slices of 10–12 rows
3. For each slice:
   a. Run `npx tsx computed-styles.ts --url ... --batch <slice-batch.json> ...`
   b. Compare actual vs expected for each row
   c. Tally pass/fail/pending counts (cumulative)
   d. **Immediately print** the progress line: `[pixel-twin] measuring... <done>/<total> rows  <bar>  <pct>%  pass:<P>  fail:<F>  pending:<X>`
4. After all slices done, write the full results to `review-result-<nodeId>.json`

This gives the user visible progress throughout the run, not just at the end.

Wait for agent (if using VRA). Read `PROJECT_ROOT/.claude/pixel-twin/review-result-<nodeId>.json`.

### 5c — Code Review Agent (`claude-haiku-4-5-20251001`, file: `code-review-agent.md`)

```
PROJECT_ROOT:               <absolute path>
CHANGED_FILES:              <from impl-result-<nodeId>.json .filesChanged>
FIGMA_FILE_KEY:             <fileKey>
COMPONENT_NODE_ID:          <nodeId>
PIXEL_TWIN_ROOT:            <absolute path>
COMMANDS:
  typecheck: npm run typecheck
  lint: npm run lint
  test: npm run test
DESIGN_SYSTEM:              <config.designSystem>
SAFETY_PROFILE:             <config.safetyProfile>
CONVENTION_PROFILE:         <config.conventionProfile>
PHI_SANITIZATION_FUNCTIONS: <config.phiSanitizationFunctions joined as comma-separated string>
```

Print: `[pixel-twin] [N/TOTAL] <figmaName> — code review...`

Wait for agent. Read `PROJECT_ROOT/.claude/pixel-twin/code-result-<nodeId>.json`.

If code review `hasBlockers: true`: upgrade model to `claude-sonnet-4-6` and re-run code review once before treating as a blocker.

### 5d — Evaluate

Read `review-result-<nodeId>.json` and `code-result-<nodeId>.json`.

**All pass** (`failCount == 0`, code `hasBlockers == false`):

Compute progress bar from all rows in the Coverage Map (across ALL completed components so far):
- `pct` = `passCount / totalRows * 100` (exclude pending rows from denominator if desired, but include them in count)
- `filled` = `round(pct / 5)` blocks (20 blocks = 100%)

Print:
```
[pixel-twin] [N/TOTAL] <figmaName> — ✅ PASS
  <filled>░<empty> <pct>%  pass:<passCount>  fail:<failCount>  pending:<pendingCount>  conflict:<conflictCount>
```
Example:
```
[pixel-twin] [1/1] Pagination — ✅ PASS
  ██████████████████░░  90%  pass:41  fail:0  pending:3  conflict:0
```
Update queue: move from `pendingComponents` to `completedComponents`. Write queue file. Proceed to next component.

**Has failures** (iteration 1–4):

Print CSS failures (selector/property/expected/got) and code blockers (file:line/issue).

**⛔ MANDATORY GATE — Figma re-verification before dispatching Implementation Agent:**

For every FAIL row, call `get_design_context` with its `figmaNodeId` and `FIGMA_FILE_KEY`. Then print a citation block for each:

```
[pixel-twin] Figma re-verify — <selector> / <property>
  figma nodeId:  <figmaNodeId>
  figma says:    <value from get_design_context>
  map expected:  <expected field in Coverage Map>
  measured:      <actual field from VRA>
  verdict:       match | ⚠️ map was wrong — updating expected to <correct value>
```

If `get_design_context` returns a value that **differs from** the Coverage Map `expected`:
- Update the Coverage Map `expected` field to the Figma value **before** dispatching the Implementation Agent
- Do NOT dispatch the agent with a wrong `expected` value — it will loop forever fixing toward the wrong target

If `get_design_context` cannot be called (network error): set the row to `status: "needs-verify"` and **stop** — do not guess. Escalate to engineer.

Only after this block is printed and any Coverage Map corrections are written: increment `ITERATION`, set `PREVIOUS_REVIEW_PATH`, loop to Step 5a.

Print progress after each failed iteration too:
```
[pixel-twin] [N/TOTAL] <figmaName> — ❌ iter <I>/4
  ██████████░░░░░░░░░░  50%  pass:<P>  fail:<F>  pending:<X>  conflict:<C>
```

**Iteration 5** (stuck): Print remaining failures + "Options: A. Provide hint and retry  B. Skip". Wait for engineer before proceeding.

**Only `figma_conflict` rows** (no `fail` rows):
Log conflicts to `figmaDiscrepancies` in the Coverage Map and proceed — these are Figma inconsistencies, not code bugs. Designer should be notified separately.

---

## Step 6 — Final sign-off

Write `PROJECT_ROOT/.claude/pixel-twin/reports/<frameId>-<ISO-date>.md` containing: run header (mode, frame URL, total properties), results table (Component | Pass | Fail | Figma Conflict | Stuck), failures list (selector / property / expected / actual), Figma inconsistencies list.

Compute final totals across all components and print:

```
[pixel-twin] Complete — <frameId>
  ████████████████████  100%  pass:<P>/<total>  fail:<F>  pending:<X>  conflict:<C>  stuck:<S>
  ✅ Passed:  <component names>
  🔴 Stuck:   <component names, or "none">
  ⚠️  Figma conflicts: <selector list, or "none">
Report: .claude/pixel-twin/reports/<frameId>-<date>.md  No git changes made.
```

If `fail > 0` or `stuck > 0`, print the percentage in red-equivalent context (plain text: use `❌` prefix instead of `✅`):
```
[pixel-twin] ❌ <pct>% pass — <F> failures remain
```
