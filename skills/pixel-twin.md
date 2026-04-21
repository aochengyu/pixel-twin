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

## Step 0 — Load config and check dev server

### 0a — Read project config

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

Send a GET to `http://localhost:<config.port>`.

- 200 → already running, proceed
- Connection refused → print: `"Dev server is not running. Start it (e.g. \`npm run dev\`) then try again."` and stop.

### 0c — Pre-flight clarification

Ask the user all four questions in a **single message**. Do not ask them one by one. Do not proceed to Step 1 until answers are received.

**Questions to ask:**

> Before I start building the Coverage Map, I need four quick answers:
>
> 1. **UI states** — Does this component have interactive states that need separate measurement? (e.g. hover, active, tab selected, modal open, error state, empty vs. filled). If yes, list them and describe the interaction that triggers each (e.g. "click the Exceptions tab").
>
> 2. **Authentication** — Does reaching this page require login? If yes: is there already an `auth` helper configured in `.claude/pixel-twin.config.ts`? If not, what file should I use?
>
> 3. **Dynamic data** — Does this component render differently based on data (e.g. 0 rows vs. many, loading state vs. loaded)? If yes: is there an MSW handler or fixture that provides deterministic data? What state should be active during verification?
>
> 4. **Exclusions** — Are there components in this frame that should be skipped? (e.g. third-party embeds, animated loaders, elements with random/time-dependent values). List their Figma layer names or `data-testid` values.
>
> **Tips for a faster pixel-twin run:**
> - Use Figma tokens (not raw hex) — pixel-twin detects Dart token mismatches only when the token is in Figma
> - Represent each interactive state as a separate Figma frame if possible
> - Use realistic content dimensions in the Figma frame (real text lengths, not lorem ipsum placeholders)
> - If a component has a loading state, tell me what fixture makes it always render "loaded"

After receiving answers, record:
- `clarification.uiStates`: list of `{ name, setupInteractions: [{ action, selector, waitFor? }] }` — empty list if none
- `clarification.authRequired`: true/false; if true, the resolved auth helper path
- `clarification.fixtureNote`: free-text description of fixture/MSW setup, or null
- `clarification.exclusions`: list of Figma layer names or testid patterns to skip during Step 3 node traversal

Use these throughout:
- **Step 3**: each entry in `clarification.uiStates` → add corresponding `"verificationMethod": "interactive"` rows with the state's `setupInteractions`; skip Figma nodes matching `clarification.exclusions`
- **Coverage Map `prerequisites`**: populate `setupInteractions` from `clarification.uiStates`; add `fixtureNote` as a comment-style field for human reference
- **All agents**: pass auth helper path if `clarification.authRequired` is true

---

## Step 1 — Regression check

Before any new work, check for existing Coverage Maps:

```
PROJECT_ROOT/.claude/pixel-twin/coverage-map-*.json
```

If any exist (for frames other than the current one), spawn a Visual Review Agent on each to confirm no regressions:

```
COVERAGE_MAP_PATH: <path to the existing coverage map>
PROJECT_ROOT: <absolute path>
PIXEL_TWIN_ROOT: <absolute path>
COMPONENT_NODE_ID: "*"   ← special value: check ALL rows in the map
```

If failures found — fix them first via an Implementation Agent cycle, then proceed.

If no existing Coverage Maps: skip this step.

---

## Step 2 — Mode detection

Check whether `PROJECT_ROOT/.claude/pixel-twin/coverage-map-<frameId>.json` exists.

- **Does not exist** → ask: "Does this frame already have working code, or is it net-new?"
  - **Net-new (0→1)** → **Build Mode** → go to Step 3
  - **Existing code, just needs coverage** → **Adopt Mode** → go to Step 2a
- **Exists** → **Upgrade Mode** → go to Step 4

---

## Step 2a — Adopt Mode: baseline from current DOM

Use when the frame already has implemented, correct code and you only need to create a regression-prevention coverage map. Skips Figma API, skips Implementation Agent. Cost: ~1 script run.

### 2a-1 — Identify selectors

From `COMPONENT_REGISTRY_PATH` or by grepping `data-testid` attributes in the component directory, list the meaningful selectors for this frame.

### 2a-2 — Measure current DOM

For each selector, determine its element type (layout container, text node, dart/Mantine instance, SVG/icon) and measure the **complete mandatory property set** from Step 3e's property extraction matrix. Use the same property lists that Build Mode would extract — this guarantees the baseline catches the same classes of bugs.

Use batch mode for efficiency:

```bash
npx tsx <PIXEL_TWIN_ROOT>/scripts/computed-styles.ts \
  --url "<app URL>" \
  --batch <batch-file.json> \
  --auth-helper "<auth path if set>" \
  --wait-for "<waitFor selector>"
```

**Minimum properties per element type (from Step 3e):**
- Layout container: `display`, `flex-direction`, `flex-wrap`, `justify-content`, `align-items`, `gap`, `overflow`, `padding-*`, `background-color`, `border-*`, `boundingWidth`, `boundingHeight`
- Text node: `font-size`, `font-weight`, `line-height`, `font-family`, `color`, `text-align`, `letter-spacing`, `white-space`, `text-overflow`, `isOverflowingX`
- dart/Mantine instance root: `background-color`, `border-*`, `boundingWidth`, `boundingHeight`
- SVG/icon: `boundingWidth`, `boundingHeight`, `color`

### 2a-3 — Write coverage map

Write `coverage-map-<frameId>.json` using the measured values as `expected`. Set `status: "pass"` and `actual` = measured value. Set `figmaValue: null` (Figma not consulted — this is a DOM baseline, not a Figma match). Set `lastVerified` to today.

**Important**: Adopt Mode coverage maps catch regressions from the current baseline, NOT Figma drift. If you later want Figma-match verification, run Build Mode or Upgrade Mode.

### 2a-4 — Verify

Run Visual Review Agent to confirm all rows pass with the current code. If any fail, the selectors or properties are wrong — fix them before writing the map.

Print: `[pixel-twin] Adopt Mode complete — <N> rows for <frameId>. Baseline locked.`

Then go to Step 6.

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

3. **Map every Figma node to its code equivalent** before writing any code:

| Figma node name | nodeId | Expected code element / selector |
|----------------|--------|----------------------------------|
| (fill in for each node) | | |

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

### 3d-containers — Call get_design_context on significant containers

Call `get_design_context` on each significant container (`nodeId` + `fileKey`).

### 3e — Value Extractor

From each response, extract CSS property values. Responses contain Tailwind classes with values in the pattern `var(--token-name, fallback)`.

For each CSS property:
1. `var(--token, fallback)` → record `figmaValue = fallback`, `cssVar = --token`
2. Raw hex/px (no token) → record `figmaValue = value`, `cssVar = null`

Properties to extract by element type — **outside-in order: container layout first, then visual, then children.**

Every element type has a **mandatory base set** — extract these regardless of whether Figma explicitly shows the value. Absent Figma values still affect rendering via browser defaults and library resets.

**Why layout-first**: layout property bugs (wrong `flex-direction`, `min-height: 100%`, `overflow: hidden`) corrupt entire subtrees. Container layout must be verified before checking child properties.

---

#### LAYOUT CONTAINERS (any element with child nodes — FRAME, GROUP, wrapper div)

**Mandatory — always extract ALL of these:**

| Category | Properties | Tolerance |
|----------|-----------|-----------|
| Display + flex | `display`, `flex-direction`, `flex-wrap`, `justify-content`, `align-items`, `align-content` | `exact-string` |
| Spacing | `gap`, `row-gap`, `column-gap` | `plus-minus-0.5px` |
| Overflow | `overflow`, `overflow-x`, `overflow-y` | `exact-string` |
| Padding | `padding-top`, `padding-right`, `padding-bottom`, `padding-left` | `plus-minus-0.5px` |
| Background | `background-color` | `exact-after-hex-rgb` |
| Border | `border-width`, `border-style`, `border-color`, `border-radius` | `exact-px` / `exact-string` / `exact-after-hex-rgb` |
| Bounding box | `boundingWidth`, `boundingHeight` | `plus-minus-2px` |

**Add when present in Figma or inferable from design:**

| Category | Properties | When to add |
|----------|-----------|-------------|
| Size constraints | `min-height`, `max-height`, `min-width`, `max-width`, `height`, `width` | Figma specifies a fixed or minimum dimension |
| Shadow | `box-shadow` | Figma shows a drop or inner shadow |
| Opacity | `opacity` | Figma opacity ≠ 1 (100%) |
| Position | `position`, `z-index`, `top`, `left`, `right`, `bottom` | Figma shows absolute/relative position with offsets |
| Margin | `margin-top`, `margin-right`, `margin-bottom`, `margin-left` | Figma shows non-zero margin or spacing-before |

**If this container is also a flex child (its parent is a flex container), additionally add:**

| Properties | Tolerance |
|-----------|-----------|
| `flex-grow`, `flex-shrink`, `flex-basis`, `align-self` | `exact-string` or `exact-px` as appropriate |

---

#### TEXT NODES (any element with direct text content — labels, headings, body text)

**Mandatory:**

| Properties | Tolerance |
|-----------|-----------|
| `font-size` | `exact-px` |
| `font-weight` | `exact-px` |
| `line-height` | `plus-minus-1px` |
| `font-family` | `font-family-contains` |
| `color` | `exact-after-hex-rgb` |
| `text-align` | `exact-string` |
| `letter-spacing` | `plus-minus-0.5px` |
| `white-space` | `exact-string` |
| `text-overflow` | `exact-string` |
| `isOverflowingX` | `exact-string` (expected always `"false"`) |

**Add when present in Figma:**

| Properties | When |
|-----------|------|
| `text-decoration` | Figma shows underline or strikethrough |
| `text-transform` | Figma shows uppercase/lowercase/capitalize |
| `overflow` | Text node itself has an overflow constraint |

---

#### dart/Mantine INSTANCE ROOT (outermost DOM element of a dart or Mantine component)

*Verify only the root element — never attempt to override internal Mantine sub-elements via CSS.*

**Mandatory:**

| Properties | Tolerance |
|-----------|-----------|
| `background-color` | `exact-after-hex-rgb` |
| `border-color` | `exact-after-hex-rgb` |
| `border-radius` | `exact-px` |
| `border-width` | `exact-px` |
| `boundingWidth` | `plus-minus-2px` |
| `boundingHeight` | `plus-minus-2px` |

**Add when applicable:**

| Properties | When |
|-----------|------|
| `height` | Figma specifies fixed height |
| `opacity` | Figma opacity ≠ 1 |
| `box-shadow` | Figma shows a shadow |
| `flex-grow`, `flex-shrink`, `flex-basis`, `align-self` | This instance is a flex child |

---

#### SVG / ICON ELEMENTS (any `<svg>`, icon wrapper, or `<img>` used as icon)

| Properties | Tolerance |
|-----------|-----------|
| `boundingWidth` | `plus-minus-2px` |
| `boundingHeight` | `plus-minus-2px` |
| `color` | `exact-after-hex-rgb` (for `currentColor`-based icons) |
| `fill` | `exact-after-hex-rgb` (if explicitly set, not `currentColor`) |

---

> **Classification rule — container vs instance**: A FRAME or GROUP that *wraps* dart/Mantine component instances is itself a **layout container** — always extract its full layout property set. The dart/Mantine component's own root element is an **instance root** — apply instance rules only to that root, not to any wrapper div. Do not misclassify wrapper divs as instance roots.

**Bounding-box rows (mandatory for ALL element types):**

Every significant container, every dart/Mantine instance root, every direct flex child, and every icon element gets `boundingWidth` and `boundingHeight` rows. This is the universal safety net: any layout bug — wrong flex, wrong overflow, wrong sizing, wrong min-height interaction — produces a bounding-box deviation that these rows will catch, even when the specific CSS property wasn't anticipated.

For elements where Figma shows `layoutSizingHorizontal: FILL` or code uses `w-full`/`flex-[1_0_0]`:
- Add `note: "fills parent — verify element.boundingWidth ≈ container.boundingWidth"`

If the app is not yet running (Build Mode before any code exists), set `expected: null` and `status: "needs-verify"`. Populate on first Visual Review Agent pass.

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
| `exact-after-hex-rgb` | `color`, `background-color`, `border-color`, `fill` |
| `alpha-0.01` | rgba alpha channel (±0.01) |
| `exact-px` | `font-size`, `font-weight`, `border-radius`, `border-width`, `letter-spacing` |
| `exact-string` | `display`, `flex-direction`, `flex-wrap`, `justify-content`, `align-items`, `align-content`, `align-self`, `flex-basis`, `overflow`, `overflow-x`, `overflow-y`, `white-space`, `text-overflow`, `text-align`, `text-decoration`, `text-transform`, `position`, `visibility`, `isOverflowingX`, `isOverflowingY` — exact case-insensitive string match |
| `plus-minus-1px` | `line-height`, `width`, `height`, `top`, `left`, `right`, `bottom` |
| `plus-minus-2px` | `boundingWidth`, `boundingHeight` — rendered dimensions for all significant elements |
| `plus-minus-0.5px` | `padding`, `gap`, `row-gap`, `column-gap`, `margin`, `letter-spacing` |
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

Create `PROJECT_ROOT/.claude/pixel-twin/queue-<frameId>.json`:

```json
{
  "frameId": "<frameId>",
  "mode": "build",
  "currentLevel": 0,
  "pendingComponents": [
    { "nodeId": "<level-0 nodeId>", "figmaName": "<name>", "reason": "new", "level": 0 },
    { "nodeId": "<level-1 nodeId>", "figmaName": "<name>", "reason": "new", "level": 1 },
    { "nodeId": "<level-2 nodeId>", "figmaName": "<name>", "reason": "new", "level": 2 }
  ],
  "completedComponents": []
}
```

Entries are sorted by `level` ascending. `currentLevel` starts at 0 and advances only after all components at that level reach `status: "pass"` in the Coverage Map.

Also create the reports directory if it does not exist:
`PROJECT_ROOT/.claude/pixel-twin/reports/`

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

## Step 5 — Component queue loop (outside-in, level by level)

Read the queue file. Process components **strictly by level** — never start a component at level N+1 until every component at level N has `status: "pass"` in the Coverage Map.

**Level gate logic:**
1. Filter `pendingComponents` to only those with `level == currentLevel`.
2. Process them sequentially (one at a time, not in parallel).
3. After all components at `currentLevel` pass: increment `currentLevel` in the queue file, then repeat.
4. If any component at `currentLevel` is STUCK (iteration 5, no resolution): print the stuck message, wait for engineer input before incrementing the level. **Do not proceed deeper into a broken layout.**

This enforces the outside-in principle at the orchestrator level: page shell correctness is guaranteed before sections are checked; section correctness is guaranteed before components are checked.

For each component (`nodeId`, `figmaName`), run one iteration cycle:

### 5a — Spawn Implementation Agent

Read `PIXEL_TWIN_ROOT/skills/agents/implementation-agent.md`. Spawn an Agent with:
- **model**: `claude-opus-4-7`
- **prompt**: the full content of `implementation-agent.md` + the inputs block below

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

### 5b — Spawn Visual Review Agent

Read `PIXEL_TWIN_ROOT/skills/agents/visual-review-agent.md`. Spawn an Agent with:
- **model**: `claude-sonnet-4-6`
- **prompt**: full content of `visual-review-agent.md` + inputs:

```
COVERAGE_MAP_PATH:  PROJECT_ROOT/.claude/pixel-twin/coverage-map-<frameId>.json
PROJECT_ROOT:       <absolute path>
PIXEL_TWIN_ROOT:    <absolute path>
COMPONENT_NODE_ID:  <nodeId>
AUTH_HELPER_PATH:   <AUTH_HELPER_PATH resolved in Step 0a, or null>
```

Print: `[pixel-twin] [N/TOTAL] <figmaName> — verifying...`

Wait for agent. Read `PROJECT_ROOT/.claude/pixel-twin/review-result-<nodeId>.json`.

### 5c — Spawn Code Review Agent

Read `PIXEL_TWIN_ROOT/skills/agents/code-review-agent.md`. Spawn an Agent with:
- **model**: `claude-haiku-4-5-20251001`
- **prompt**: full content of `code-review-agent.md` + inputs:

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

After all components in the queue are done, write a report to `PROJECT_ROOT/.claude/pixel-twin/reports/<frameId>-<ISO-date>.md`:

```markdown
# pixel-twin run — <frameId> — <ISO date>

Mode: build | upgrade
Frame: <figma_url>
Total properties checked: <N>

## Results

| Component | Pass | Fail | Figma Conflict | Stuck |
|-----------|------|------|----------------|-------|
| <name>    | N    | 0    | 0              | —     |

## Failures (if any)
<list of selector / property / expected / actual>

## Figma inconsistencies (flagged for designer, not failures)
<list>
```

Then print to terminal:

```
[pixel-twin] Complete.
  ✅ Passed:  <list>
  🔴 Stuck:   <list, if any>
  ⚠️  Figma inconsistencies (flagged for designer): <list, if any>

Report: .claude/pixel-twin/reports/<frameId>-<date>.md
No git changes made. Review the diff and commit when ready.
```
