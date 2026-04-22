# pixel-twin v2 Implementation Plan

**Status: COMPLETED — all tasks implemented as of 2026-04-21.**

**Goal:** Rewrite pixel-twin from the v1 ad-hoc architecture to the v2 Coverage Map-based system that achieves ~100% pixel-accurate UI verification and automated fix loops.

**Architecture:** Orchestrator (pixel-twin.md) builds a Coverage Map from Figma metadata, then runs sequential sub-agents per component: Implementation Agent (Opus) fixes code, Visual Review Agent (Sonnet) verifies computed styles against the Coverage Map, Code Review Agent (Haiku→Sonnet) checks code quality. All state is file-based; Orchestrator context stays O(1).

**Reference:** `docs/pixel-twin-v2-design.md` — all design decisions are documented there.

---

## File Map

| File | Action | Role |
|------|--------|------|
| `scripts/computed-styles.ts` | Modify | Add `--batch` mode for multi-selector runs |
| `scripts/css-variables.ts` | Create | Extract resolved CSS variable values from running app |
| `skills/pixel-twin.md` | Rewrite | Orchestrator — Coverage Map builder, mode detection, agent dispatch |
| `skills/agents/visual-review-agent.md` | Rewrite | Reads Coverage Map, runs batch computed-styles, writes results back |
| `skills/agents/implementation-agent.md` | Rewrite | Reads Coverage Map FAILs, fixes code, adds data-testids |
| `skills/agents/code-review-agent.md` | Modify | Add Track B (CodeConnect props check) |
| `CLAUDE.md` | Modify | Update doc references |

---

## Task 1: Add batch mode to computed-styles.ts

**Files:**
- Modify: `scripts/computed-styles.ts`

Current limitation: opens a new browser per call. In v2, Visual Review Agent needs to check 20–40 selectors per component. Batch mode opens the browser once and runs all checks.

- [x] **Step 1: Replace computed-styles.ts with batch-capable version**

```typescript
#!/usr/bin/env tsx
/**
 * pixel-twin: computed styles extractor
 *
 * Single mode:  --url <url> --selector <css> [--properties <list>]
 * Batch mode:   --url <url> --batch <json-file>
 *
 * Batch JSON input:  [{ "selector": string, "properties": string[] }]
 * Batch JSON output: [{ "selector": string, "properties": Record<string,string>, "error": string|null }]
 *
 * Single JSON output: Record<string, string>
 */

import { chromium, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import path from "path"
import { pathToFileURL } from "url"
import { parseArgs, die } from "./_args.js"

const HELP = `
pixel-twin: computed-styles extractor

Usage (single):
  tsx scripts/computed-styles.ts --url <url> --selector <css> [options]

Usage (batch):
  tsx scripts/computed-styles.ts --url <url> --batch <json-file> [options]

Required:
  --url <url>             Page URL to navigate to
  --selector <css>        CSS selector (single mode)
  --batch <json-file>     Path to JSON file: [{ selector, properties }] (batch mode)

Options:
  --auth-helper <path>    Path to a .ts file exporting: default async (page: Page) => void
  --wait-for <selector>   Wait for this selector before extracting (default: same as --selector)
  --properties <list>     Comma-separated CSS properties (single mode only)
  --viewport-width <px>   Viewport width (default: 1440)
  --viewport-height <px>  Viewport height (default: 900)
  --help                  Show this help

Batch JSON input format:
  [{ "selector": "[data-testid='foo']", "properties": ["background-color","padding-left"] }]

Batch JSON output format:
  [{ "selector": "...", "properties": { "background-color": "rgb(255,255,255)" }, "error": null }]
`

async function loadAuthHelper(helperPath: string): Promise<(page: Page) => Promise<void>> {
  const url = pathToFileURL(path.resolve(helperPath)).href
  const mod = await import(url)
  const fn = mod.default ?? mod.setup
  if (typeof fn !== "function") {
    die(`Auth helper at ${helperPath} must export a default async function (page: Page) => void`)
  }
  return fn
}

interface BatchItem {
  selector: string
  properties: string[]
}

interface BatchResult {
  selector: string
  properties: Record<string, string>
  error: string | null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args["help"]) {
    console.log(HELP)
    process.exit(0)
  }

  const url = args["url"] as string | undefined
  const selector = args["selector"] as string | undefined
  const batchFile = args["batch"] as string | undefined
  const authHelperPath = args["auth-helper"] as string | undefined
  const waitForSelector = args["wait-for"] as string | undefined
  const propertiesArg = args["properties"] as string | undefined
  const viewportWidth = parseInt((args["viewport-width"] as string | undefined) ?? "1440", 10)
  const viewportHeight = parseInt((args["viewport-height"] as string | undefined) ?? "900", 10)

  if (!url) die("--url is required")
  if (!selector && !batchFile) die("either --selector or --batch is required")

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: viewportWidth, height: viewportHeight } })
    const page = await context.newPage()

    if (authHelperPath) {
      const authFn = await loadAuthHelper(authHelperPath)
      await authFn(page)
    }

    await page.goto(url!, { waitUntil: "networkidle" })

    if (batchFile) {
      // --- Batch mode ---
      const items: BatchItem[] = JSON.parse(readFileSync(batchFile, "utf-8"))

      // Wait for the first selector as a proxy for page readiness
      if (waitForSelector) {
        await page.waitForSelector(waitForSelector, { timeout: 15_000 })
      } else if (items.length > 0) {
        await page.waitForSelector(items[0].selector, { timeout: 15_000 }).catch(() => {
          // Non-fatal: first selector may not exist (new component)
        })
      }

      const results: BatchResult[] = []
      for (const item of items) {
        try {
          const el = page.locator(item.selector).first()
          const count = await el.count()
          if (count === 0) {
            results.push({ selector: item.selector, properties: {}, error: `Selector not found: ${item.selector}` })
            continue
          }
          const props = await el.evaluate(
            (node, properties) => {
              const computed = window.getComputedStyle(node)
              return Object.fromEntries(
                properties.map((p: string) => [p, computed.getPropertyValue(p).trim()])
              )
            },
            item.properties
          )
          results.push({ selector: item.selector, properties: props, error: null })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          results.push({ selector: item.selector, properties: {}, error: msg })
        }
      }

      console.log(JSON.stringify(results, null, 2))
    } else {
      // --- Single mode ---
      const specificProperties = propertiesArg
        ? propertiesArg.split(",").map((p) => p.trim()).filter(Boolean)
        : null

      const waitTarget = waitForSelector ?? selector!
      await page.waitForSelector(waitTarget, { timeout: 15_000 })

      const styles = await page
        .locator(selector!)
        .first()
        .evaluate(
          (el, props) => {
            const computed = window.getComputedStyle(el)
            if (props) {
              return Object.fromEntries(
                props.map((p: string) => [p, computed.getPropertyValue(p).trim()])
              )
            }
            return Object.fromEntries(
              Array.from(computed).map((prop) => [
                prop,
                computed.getPropertyValue(prop).trim(),
              ])
            )
          },
          specificProperties
        )

      console.log(JSON.stringify(styles, null, 2))
    }
  } finally {
    await browser.close()
  }
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err))
  console.error(JSON.stringify({ error: e.constructor.name, message: e.message }))
  process.exit(1)
})
```

- [x] **Step 2: Verify batch mode works**

```bash
# Create a test batch file
cat > /tmp/test-batch.json << 'EOF'
[
  { "selector": "body", "properties": ["background-color", "font-size"] },
  { "selector": "h1", "properties": ["font-size", "color"] }
]
EOF

# Run against any live page (use your dev server if running, or a public URL)
cd /Users/aocheng.yu/Documents/pixel-twin
npx tsx scripts/computed-styles.ts \
  --url http://localhost:5173/requests \
  --batch /tmp/test-batch.json \
  --wait-for body
```

Expected output: JSON array with two entries, each having `selector`, `properties` (filled), `error: null`. If selector not found: `error: "Selector not found: h1"`.

- [x] **Step 3: Commit**

```bash
cd /Users/aocheng.yu/Documents/pixel-twin
git add scripts/computed-styles.ts
git commit -m "feat: add batch mode to computed-styles.ts"
```

---

## Task 2: Create css-variables.ts

**Files:**
- Create: `scripts/css-variables.ts`

Needed by the Coverage Map Builder to resolve Dart V1 CSS token values (the `dartV1Value` field in Coverage Map rows). Extracts `getComputedStyle(document.documentElement).getPropertyValue(varName)` from the running app.

- [x] **Step 1: Create css-variables.ts**

```typescript
#!/usr/bin/env tsx
/**
 * pixel-twin: CSS variable resolver
 *
 * Extracts resolved CSS variable values from a running app's document element.
 * Used by the Coverage Map Builder to get Dart V1 token values.
 *
 * Usage:
 *   tsx scripts/css-variables.ts --url <url> --vars <list> [options]
 *
 * stdout: JSON { [varName: string]: string }
 * stderr: JSON { error, message }
 */

import { chromium, type Page } from "@playwright/test"
import path from "path"
import { pathToFileURL } from "url"
import { parseArgs, die } from "./_args.js"

const HELP = `
pixel-twin: CSS variable resolver

Usage:
  tsx scripts/css-variables.ts --url <url> --vars <list> [options]

Required:
  --url <url>            Page URL to navigate to
  --vars <list>          Comma-separated CSS variable names (with or without --)
                         e.g. --surface-base-default,--text-on-base-heading

Options:
  --auth-helper <path>   Path to a .ts file exporting: default async (page: Page) => void
  --wait-for <selector>  Wait for this selector before extracting (default: body)
  --help                 Show this help

stdout: JSON { "--var-name": "resolved-value", ... }

Example:
  tsx scripts/css-variables.ts \\
    --url http://localhost:5173/requests \\
    --vars --surface-base-default,--text-on-base-heading,--border-default
`

async function loadAuthHelper(helperPath: string): Promise<(page: Page) => Promise<void>> {
  const url = pathToFileURL(path.resolve(helperPath)).href
  const mod = await import(url)
  const fn = mod.default ?? mod.setup
  if (typeof fn !== "function") {
    die(`Auth helper at ${helperPath} must export a default async function (page: Page) => void`)
  }
  return fn
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args["help"]) {
    console.log(HELP)
    process.exit(0)
  }

  const url = args["url"] as string | undefined
  const varsArg = args["vars"] as string | undefined
  const authHelperPath = args["auth-helper"] as string | undefined
  const waitFor = (args["wait-for"] as string | undefined) ?? "body"

  if (!url) die("--url is required")
  if (!varsArg) die("--vars is required")

  // Normalize: ensure each var starts with "--"
  const varNames = varsArg
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => (v.startsWith("--") ? v : `--${v}`))

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()

    if (authHelperPath) {
      const authFn = await loadAuthHelper(authHelperPath)
      await authFn(page)
    }

    await page.goto(url!, { waitUntil: "networkidle" })
    await page.waitForSelector(waitFor, { timeout: 15_000 })

    const values = await page.evaluate((vars: string[]) => {
      const style = window.getComputedStyle(document.documentElement)
      return Object.fromEntries(
        vars.map((v) => [v, style.getPropertyValue(v).trim()])
      )
    }, varNames)

    console.log(JSON.stringify(values, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err))
  console.error(JSON.stringify({ error: e.constructor.name, message: e.message }))
  process.exit(1)
})
```

- [x] **Step 2: Verify css-variables.ts works**

```bash
cd /Users/aocheng.yu/Documents/pixel-twin
npx tsx scripts/css-variables.ts \
  --url http://localhost:5173/requests \
  --vars "--surface-base-default,--text-on-base-heading,--border-default" \
  --auth-helper scripts/auth-integrated-roi.ts
```

Expected: JSON object with resolved rgb/hex values. Empty string `""` means the variable is not defined on `:root` (not an error — means Figma is using a hardcoded value, not a token).

- [x] **Step 3: Commit**

```bash
git add scripts/css-variables.ts
git commit -m "feat: add css-variables.ts for Dart V1 token resolution"
```

---

## Task 3: Rewrite pixel-twin.md (Orchestrator)

**Files:**
- Rewrite: `skills/pixel-twin.md`

Complete rewrite. The new Orchestrator owns Coverage Map building, mode detection, diff logic, and sequential agent dispatch. It never writes code, never reviews code — it only coordinates.

- [x] **Step 1: Replace skills/pixel-twin.md with the v2 Orchestrator**

```markdown
---
name: pixel-twin
description: Pixel-accurate UI implementation from Figma. Supports Build Mode (0→1 new UI) and Upgrade Mode (targeted fixes). Uses Coverage Map for systematic, measurable verification. Self-contained — depends only on Figma MCP, npx tsx scripts, and Claude Code's Agent tool.
---

# pixel-twin Orchestrator

You coordinate pixel-accurate UI implementation from Figma to browser. You build Coverage Maps, dispatch sequential sub-agents, and track per-component progress until every property passes.

**You do not write code. You do not review code. You direct, measure, and decide.**

---

## Dependencies (the only three you have)

- **Figma MCP**: `get_metadata`, `get_design_context`
- **Scripts**: `npx tsx <PIXEL_TWIN_ROOT>/scripts/*.ts`
- **Claude Code Agent tool**: spawn sub-agents with content of `skills/agents/*.md` as the prompt

`PIXEL_TWIN_ROOT` = the directory containing this file's parent (`skills/`) — i.e. the root of the pixel-twin repo. Locate it at startup.

---

## Inputs

```
/pixel-twin <figma_url>
```

Parse `figma_url`:
- `fileKey`: from `/design/:fileKey/` in the URL
- `nodeId`: from `?node-id=X-Y` — convert `-` to `:`
- `frameId`: nodeId with `:` replaced by `-` (used in filenames)

If `figma_url` is missing or resolves to the root canvas (node-id `0:1` or absent): call `get_metadata` with the file key and no nodeId to list top-level frames. Print them and ask the user to select one.

---

## Step 0 — Check dev server

Send a GET request to `http://localhost:5173` (or check `.claude/pixel-twin.config.ts` for a custom port if it exists).

- 200 → already running, proceed
- Connection refused → print: `"Dev server is not running. Start it with \`npm run dev\` and try again."` then stop

---

## Step 1 — Mode detection

Check whether `.claude/pixel-twin/coverage-map-<frameId>.json` exists in `PROJECT_ROOT` (the project being worked on, not PIXEL_TWIN_ROOT).

- **File does not exist** → **Build Mode** (go to Step 2)
- **File exists** → **Upgrade Mode** (go to Step 3)

`PROJECT_ROOT` = `process.cwd()` when pixel-twin is invoked (the app being built/upgraded).

---

## Step 2 — Build Mode: Coverage Map Builder

### 2a — Fetch node tree

Call `get_metadata` with `fileKey` and `nodeId`. Record the full node tree.

### 2b — Filter auto-named nodes

Apply these rules to every node:
- **Category B** (skip entirely, including all children): name matches `/^[0-9a-f]{16,}(\s+\d+)?$/` — these are third-party EHR elements not owned by this codebase
- **Category A** (skip the node row but traverse its children): name matches `/^(Frame|Group|Rectangle|Ellipse|Vector)\s+\d+$/` — auto-named wrappers

### 2c — Identify significant containers

From the remaining named nodes, select ~4–6 **significant containers** — nodes that:
1. Have a semantic name (not auto-named)
2. Group a recognizable UI section (not a leaf text or icon)
3. Are at an appropriate depth (not the root frame itself, not individual label text)

Examples of significant containers: `Filter Sidebar`, `Table Header`, `Table Row`, `Status Badge Section`.
Examples that are NOT significant containers: `Filter Label`, `Icon`, `Frame 7` (auto-named).

### 2d — Call get_design_context

For each significant container, call `get_design_context` with its `nodeId` and `fileKey`.

### 2e — Value Extractor

From each `get_design_context` response, extract CSS property values. The response contains Tailwind classes with embedded values in this pattern: `var(--token-name, #fallback)` or `var(--token-name, Npx)`.

For each CSS property in the Tailwind classes:
1. If value is `var(--token-name, fallback)`: record `figmaValue = fallback`, `cssVar = --token-name`
2. If value is a raw hex/px (no token): record `figmaValue = value`, `cssVar = null`

Properties to extract per node type:
- **Layout containers**: `background-color`, `padding-top/right/bottom/left`, `gap`, `border-radius`, `border-color`, `border-width`
- **TEXT nodes**: `font-size`, `line-height`, `font-weight`, `color`, `font-family`
- **dart/Mantine INSTANCE root**: `background-color`, `border-color`, `border-radius`, height (bounding-box only)
- **Custom components**: all of the above

### 2f — CSS Variable Extraction

For every unique `cssVar` collected in 2e, run:

```bash
npx tsx <PIXEL_TWIN_ROOT>/scripts/css-variables.ts \
  --url "<prerequisites.url>" \
  --vars "<comma-separated cssVar names>" \
  --auth-helper "<auth script if needed>" \
  --wait-for "body"
```

Record the resolved value as `dartV1Value` for each row.

Three-way comparison rule:
- `figmaValue` ≠ `dartV1Value` → `figmaConflict: true` (Figma is stale; Dart V1 is correct)
- `expected = dartV1Value` (source of truth)
- If `cssVar = null`: `expected = figmaValue` (no token, use Figma value directly)

### 2g — Assign selectors

For each extracted property row, assign a CSS selector using this priority order:

1. **data-testid** (preferred): `[data-testid="<kebab-case-of-figma-layer-name>"]`
2. **Meaningful ancestor + nth-child**: for table cells, `[data-testid="roi-table"] thead th:nth-child(N)`
3. **HTML semantic**: `thead th`, `tbody tr:first-child td`, etc.

If `data-testid` does not yet exist on the element (Build Mode), record what it should be — Implementation Agent will add it.

### 2h — Write Coverage Map

Create `PROJECT_ROOT/.claude/pixel-twin/coverage-map-<frameId>.json`:

```json
{
  "frameId": "<frameId>",
  "figmaUrl": "<original figma_url>",
  "lastVerified": null,
  "prerequisites": {
    "url": "<inferred from Figma frame context — see auto-inference rules below>",
    "auth": "<path to auth helper, if applicable>",
    "waitFor": "<inferred — e.g. 'tbody tr' if table rows visible in frame>",
    "viewport": { "width": <frame width>, "height": <frame height> },
    "stableCondition": "networkidle",
    "setupInteractions": []
  },
  "rows": [
    {
      "selector": "<CSS selector>",
      "figmaNodeId": "<nodeId>",
      "property": "<css-property>",
      "figmaValue": "<value from Figma>",
      "dartV1Value": "<resolved token value or same as figmaValue>",
      "figmaConflict": false,
      "expected": "<dartV1Value>",
      "actual": null,
      "status": "pending",
      "tolerance": "<tolerance-key — see Tolerance Rules below>"
    }
  ],
  "figmaDiscrepancies": []
}
```

**Prerequisites auto-inference rules:**
- Frame contains a table with rows → `waitFor: "tbody tr"`
- Frame width → `viewport.width`
- Sidebar visible → add to `setupInteractions` note: "sidebar defaults open"
- If you cannot infer a required field → leave it as `null` and print: `"⚠️ Manual setup needed: prerequisites.<field> is null — fill it in before running verification"`

**Tolerance key reference:**
- `exact-after-hex-rgb`: color/background-color/border-color
- `alpha-0.01`: rgba alpha channel
- `exact-px`: font-size, font-weight, border-radius, border-width
- `plus-minus-1px`: line-height, width, height (bounding-box)
- `plus-minus-0.5px`: padding, gap, margin
- `box-shadow-normalized`: box-shadow (parse → normalize → sort → exact)
- `font-family-contains`: font-family

### 2i — Initialize component registry

Create `PROJECT_ROOT/.claude/pixel-twin/component-registry.json`:

```json
{
  "<nodeId>": {
    "figmaName": "<layer name>",
    "type": "page",
    "filePath": "<inferred route file, e.g. app/routes/list.tsx>",
    "parentFrame": null
  }
}
```

For child components found in the Figma tree, add entries with `type: "component"` and `parentFrame: "<frameId>"`. Leave `filePath` blank if unknown — Implementation Agent will fill it in.

Print the Coverage Map summary:
```
[pixel-twin] Coverage Map built: <N> rows across <M> components
[pixel-twin] Components: <list of component names>
[pixel-twin] Prerequisites: <auto-inferred fields listed>
[pixel-twin] ⚠️ Manual: <any null fields that need engineer input>
```

Pause if any `prerequisites` field is null. Ask the engineer to fill in the missing value in the JSON file before continuing.

---

## Step 3 — Upgrade Mode: Diff

### 3a — Fetch current Figma state

Call `get_metadata` with `fileKey` and `nodeId`. Get the current node tree.

### 3b — Compare to Coverage Map

Read `PROJECT_ROOT/.claude/pixel-twin/coverage-map-<frameId>.json`. For each node in the Figma tree:

- **Changed**: node `figmaNodeId` exists in Coverage Map rows, but calling `get_design_context` on it reveals different values than stored in `figmaValue` fields
- **New**: node not in any Coverage Map row and not in component-registry
- **Moved**: node in registry but has a different parent in the current Figma tree

To check for Changed nodes efficiently: only call `get_design_context` on nodes that were significant containers in the original build. Compare returned values to stored `figmaValue` fields.

### 3c — Present diff summary and wait

```
[pixel-twin] Upgrade Mode — diff vs Coverage Map:
  Changed  (N): <component names>
  New      (N): <component names>
  Moved    (N): <component names>

Process all, or specify which to skip?
```

Wait for engineer response. Default: process all.

### 3d — Write queue

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

---

## Step 4 — Component queue loop

Read the queue file. For each entry in `pendingComponents`, process sequentially. Never process two components in parallel.

### 4a — Spawn Implementation Agent

Read `PIXEL_TWIN_ROOT/skills/agents/implementation-agent.md`. Spawn an Agent with model `claude-opus-4-6` using that file's content as the prompt, with these inputs appended:

```
COVERAGE_MAP_PATH: PROJECT_ROOT/.claude/pixel-twin/coverage-map-<frameId>.json
COMPONENT_REGISTRY_PATH: PROJECT_ROOT/.claude/pixel-twin/component-registry.json
PROJECT_ROOT: <absolute path>
PIXEL_TWIN_ROOT: <absolute path>
COMPONENT_NODE_ID: <nodeId from queue entry>
FIGMA_FILE_KEY: <fileKey>
MODE: build | upgrade
```

The Implementation Agent will:
- Read Coverage Map rows for this component
- Find or create the source file
- Fix/implement properties
- Add data-testid
- Update component-registry.json
- Write a result file: `.claude/pixel-twin/impl-result-<nodeId>.json`

Print: `[pixel-twin] [N/TOTAL] <name> — implementing...`

Wait for agent to complete. Read `.claude/pixel-twin/impl-result-<nodeId>.json`.

### 4b — Spawn Visual Review Agent

Read `PIXEL_TWIN_ROOT/skills/agents/visual-review-agent.md`. Spawn an Agent with model `claude-sonnet-4-6` with inputs:

```
COVERAGE_MAP_PATH: PROJECT_ROOT/.claude/pixel-twin/coverage-map-<frameId>.json
PROJECT_ROOT: <absolute path>
PIXEL_TWIN_ROOT: <absolute path>
COMPONENT_NODE_ID: <nodeId>
```

The Visual Review Agent will:
- Read Coverage Map rows for this nodeId
- Run batch computed-styles
- Write actual values + status (pass/fail/figma_conflict) back to Coverage Map
- Write `.claude/pixel-twin/review-result-<nodeId>.json`

Print: `[pixel-twin] [N/TOTAL] <name> — verifying...`

Wait for agent to complete. Read `.claude/pixel-twin/review-result-<nodeId>.json`.

### 4c — Spawn Code Review Agent

Read `PIXEL_TWIN_ROOT/skills/agents/code-review-agent.md`. Spawn an Agent with model `claude-haiku-4-5-20251001` with inputs:

```
PROJECT_ROOT: <absolute path>
CHANGED_FILES: <list from impl-result.json>
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

Write `.claude/pixel-twin/code-result-<nodeId>.json`.

Print: `[pixel-twin] [N/TOTAL] <name> — code review...`

### 4d — Evaluate results

Read all three result files. Evaluate:

**All PASS** (Coverage Map has 0 FAIL rows for this nodeId, code review has no blockers):
```
[pixel-twin] [N/TOTAL] <name> — ✅ PASS (X/Y properties, 0 code blockers)
```
Move component from `pendingComponents` to `completedComponents` in queue file.

**Has FAIL rows or code blockers** (iteration ≤ 4):
```
[pixel-twin] [N/TOTAL] <name> — ❌ FAIL (iteration I/4)
  CSS failures (K):
    - [data-testid="filter-sidebar"]: background-color — expected rgb(255,255,255) got rgb(248,248,248)
  Code blockers (M):
    - FilterSidebar.tsx:47 — PHI logged raw
```
Loop back to Step 4a for this component (increment iteration counter).

**Iteration 5** (stuck):
```
[pixel-twin] [N/TOTAL] <name> — 🔴 STUCK after 4 iterations
  Remaining failures:
    <list>
  What I tried:
    <summary from impl-result files>

  Options:
    A. Provide a hint or additional context and retry
    B. Skip this component for now
```
Wait for engineer input before proceeding.

**FIGMA_CONFLICT rows only** (no FAIL):
Log to `figmaDiscrepancies` in Coverage Map and proceed — these are Figma inconsistencies, not code bugs.

### 4e — After all components complete

Print final summary:
```
[pixel-twin] All components complete.
  ✅ Passed: <list>
  🔴 Stuck:  <list, if any>
  ⚠️  Figma inconsistencies flagged for designer: <list, if any>

No git changes made. Review the diff and commit when ready.
```

---

## Step 5 — Regression check (before Step 2/3)

Before running Steps 2 or 3, check for other existing Coverage Maps:

```
PROJECT_ROOT/.claude/pixel-twin/coverage-map-*.json
```

If any exist (other than the current frame's), run Visual Review Agent on each to verify no regressions from recent changes. If regressions found → fix them first, then proceed with the current frame.

---

## Tolerance Rules Reference

| Tolerance key | Rule |
|--------------|------|
| `exact-after-hex-rgb` | Convert hex to rgb, then exact match |
| `alpha-0.01` | rgba alpha channel: ±0.01 |
| `exact-px` | Exact match (font-size, font-weight, border-radius, border-width) |
| `plus-minus-1px` | ±1px (line-height, width, height) |
| `plus-minus-0.5px` | ±0.5px (padding, gap, margin) |
| `box-shadow-normalized` | Parse all shadow values, normalize, sort, exact match |
| `font-family-contains` | actual must contain expected font name (case-insensitive) |

**Rendering deltas (auto-accept, never fail):**
- box-shadow blur ±1px when color and spread match
- Sub-pixel gaps ≤0.5px
- Font anti-aliasing differences

**Figma stale (not a FAIL):**
- If `actual == dartV1Value` but `actual ≠ figmaValue`: status = `figma_conflict`, not `fail`
```

- [x] **Step 2: Verify the skill file references correct paths and covers all spec sections**

Cross-check against `docs/pixel-twin-v2-design.md` sections:
- [x] Section 3 (mode detection) → Step 1 ✓
- [x] Section 8 (Coverage Map Builder) → Step 2a–2i ✓
- [x] Section 11 (auto-named frames) → Step 2b ✓
- [x] Section 12 (prerequisites) → Step 2h ✓
- [x] Section 13 (tolerance rules) → Tolerance Rules Reference ✓
- [x] Section 14 (data-testid) → Step 2g ✓
- [x] Section 15 (component registry) → Step 2i ✓
- [x] Section 16 (upgrade mode diff) → Step 3 ✓
- [x] Section 17 (outside-in levels) → covered in Step 2c significant container selection ✓
- [x] Section 18 (regression) → Step 5 ✓

- [x] **Step 3: Commit**

```bash
git add skills/pixel-twin.md
git commit -m "feat: rewrite pixel-twin.md as v2 Coverage Map orchestrator"
```

---

## Task 4: Rewrite visual-review-agent.md

**Files:**
- Rewrite: `skills/agents/visual-review-agent.md`

v2 Visual Review Agent is simpler than v1: the Coverage Map already tells it exactly what to check and what the expected values are. It does not call Figma or build anything — it just runs computed-styles and writes results back.

- [x] **Step 1: Replace skills/agents/visual-review-agent.md**

```markdown
---
name: pixel-twin/visual-review-agent
description: Stateless Visual Review Agent for pixel-twin v2. Reads Coverage Map rows for a specific component, runs batch computed-styles, applies tolerance rules, writes actual values and pass/fail status back to the Coverage Map JSON, and outputs a result file.
---

# pixel-twin: Visual Review Agent

You are a stateless verification agent. You receive a Coverage Map path and a component node ID. You run computed-styles checks and write the results back to the Coverage Map. You do not fix code. You do not call Figma. You measure and record.

---

## Inputs

```
COVERAGE_MAP_PATH: <absolute path to .claude/pixel-twin/coverage-map-<frameId>.json>
PROJECT_ROOT:      <absolute path to project being reviewed>
PIXEL_TWIN_ROOT:   <absolute path to pixel-twin repo>
COMPONENT_NODE_ID: <figmaNodeId to verify — filters which Coverage Map rows to check>
```

---

## Step 1 — Read Coverage Map

Read `COVERAGE_MAP_PATH`. Extract all rows where `figmaNodeId == COMPONENT_NODE_ID` and `status != "pass"` (skip already-passing rows on re-runs).

If no rows match: write result file with `{ "passCount": 0, "failCount": 0, "skipped": true }` and stop.

---

## Step 2 — Set up page state

From the Coverage Map `prerequisites` block:
- Navigate to `prerequisites.url`
- If `prerequisites.auth` is set: run the auth script before navigating
- After navigation, wait for `prerequisites.waitFor` selector
- Set viewport to `prerequisites.viewport`
- Run any `prerequisites.setupInteractions` if present

---

## Step 3 — Build batch request

Group rows by selector (multiple properties on the same element can share one batch entry).

Build a batch items array:
```json
[
  {
    "selector": "[data-testid='filter-sidebar']",
    "properties": ["background-color", "padding-left", "padding-right"]
  },
  {
    "selector": "[data-testid='filter-sidebar'] .mantine-TextInput-root",
    "properties": ["font-size", "line-height", "color"]
  }
]
```

Write to a temp file: `/tmp/pixel-twin-batch-<COMPONENT_NODE_ID>.json`

---

## Step 4 — Run batch computed-styles

```bash
npx tsx <PIXEL_TWIN_ROOT>/scripts/computed-styles.ts \
  --url "<prerequisites.url>" \
  --batch /tmp/pixel-twin-batch-<COMPONENT_NODE_ID>.json \
  --wait-for "<prerequisites.waitFor>" \
  --viewport-width <prerequisites.viewport.width> \
  --viewport-height <prerequisites.viewport.height> \
  [--auth-helper "<prerequisites.auth>" if set]
```

Parse the JSON array output. For each result entry, match back to Coverage Map rows by selector.

If a result has `error` (selector not found): mark all rows for that selector as `status: "selector_not_found"`.

---

## Step 5 — Apply tolerance rules and update Coverage Map

For each Coverage Map row, compare `actual` vs `expected` using the row's `tolerance` key:

| Tolerance key | Pass condition |
|--------------|----------------|
| `exact-after-hex-rgb` | Normalize both to rgb(R,G,B), exact match |
| `alpha-0.01` | Parse rgba alpha, abs diff ≤ 0.01 |
| `exact-px` | Parse px value, exact match (0 difference) |
| `plus-minus-1px` | Parse px value, abs diff ≤ 1 |
| `plus-minus-0.5px` | Parse px value, abs diff ≤ 0.5 |
| `box-shadow-normalized` | Parse each shadow: offset-x, offset-y, blur, spread, color. Normalize and sort. Exact match per field (allow blur ±1px). |
| `font-family-contains` | actual.toLowerCase().includes(expected.toLowerCase()) |

**Special rule — Figma stale:**
Before applying tolerance, check: if `actual == dartV1Value` (within tolerance) but `figmaValue` differs → set `status: "figma_conflict"`, add to `figmaDiscrepancies`. This is NOT a failure.

**Status assignments:**
- Within tolerance → `status: "pass"`
- Outside tolerance, actual ≠ dartV1Value → `status: "fail"`
- actual ≈ dartV1Value but ≠ figmaValue → `status: "figma_conflict"`
- Selector not found → `status: "selector_not_found"`

Write updated `actual` and `status` back to each row in the Coverage Map JSON file.

Update `lastVerified` in the Coverage Map to current ISO timestamp.

---

## Step 6 — Write result file

Write `PROJECT_ROOT/.claude/pixel-twin/review-result-<COMPONENT_NODE_ID>.json`:

```json
{
  "componentNodeId": "<COMPONENT_NODE_ID>",
  "passCount": 18,
  "failCount": 3,
  "figmaConflictCount": 1,
  "selectorNotFoundCount": 0,
  "failures": [
    {
      "selector": "[data-testid='filter-sidebar']",
      "property": "background-color",
      "expected": "rgb(255,255,255)",
      "actual": "rgb(248,248,248)",
      "tolerance": "exact-after-hex-rgb"
    }
  ],
  "figmaConflicts": [
    {
      "selector": "[data-testid='request-type-label']",
      "property": "font-family",
      "figmaValue": "DM Sans",
      "dartV1Value": "Geist",
      "actual": "Geist"
    }
  ]
}
```

---

## Step 7 — Print terminal summary

```
[visual-review] <componentName> (<COMPONENT_NODE_ID>)
  PASS  18/22 properties
  FAIL   3/22 properties:
    - [data-testid="filter-sidebar"]: background-color  expected rgb(255,255,255)  got rgb(248,248,248)
    - [data-testid="filter-sidebar"]: padding-left  expected 16px  got 12px
    - [data-testid="apply-button"]: font-size  expected 14px  got 12px
  FIGMA_CONFLICT  1 property (Figma stale, not a failure — logged for designer)
  SELECTOR_NOT_FOUND  0
```
```

- [x] **Step 2: Commit**

```bash
git add skills/agents/visual-review-agent.md
git commit -m "feat: rewrite visual-review-agent.md for v2 Coverage Map verification"
```

---

## Task 5: Rewrite implementation-agent.md

**Files:**
- Rewrite: `skills/agents/implementation-agent.md`

v2 Implementation Agent is given exactly what to fix (Coverage Map FAIL rows). It no longer builds its own checklist — the Coverage Map IS the checklist. In Build Mode, it creates the component; in Upgrade Mode, it fixes FAIL rows.

- [x] **Step 1: Replace skills/agents/implementation-agent.md**

```markdown
---
name: pixel-twin/implementation-agent
description: Stateless Implementation Agent for pixel-twin v2. In Build Mode, creates a new component implementing all Coverage Map rows. In Upgrade Mode, reads FAIL rows and fixes them surgically. Adds data-testids, updates component registry. Outputs an impl-result file.
---

# pixel-twin: Implementation Agent

You are the only agent that writes files. You implement or fix UI code to match the Coverage Map. You write the minimal code needed to make Coverage Map rows pass.

**Work autonomously. Read before writing. Never guess — verify with computed-styles if uncertain.**

---

## Inputs

```
COVERAGE_MAP_PATH:       <absolute path to coverage-map-<frameId>.json>
COMPONENT_REGISTRY_PATH: <absolute path to component-registry.json>
PROJECT_ROOT:            <absolute path to project>
PIXEL_TWIN_ROOT:         <absolute path to pixel-twin repo>
COMPONENT_NODE_ID:       <figmaNodeId to implement/fix>
FIGMA_FILE_KEY:          <Figma file key>
MODE:                    "build" | "upgrade"
```

---

## Phase 0 — Load design system knowledge

Before anything else, read `PIXEL_TWIN_ROOT/skills/agents/dart-knowledge.md`. This is non-negotiable — every dart prop you write must be verified against this document.

---

## Phase 1 — Read Coverage Map

Read `COVERAGE_MAP_PATH`. Extract all rows where `figmaNodeId == COMPONENT_NODE_ID`.

**Build Mode**: all rows have `status: "pending"` — you must implement all of them
**Upgrade Mode**: focus on rows with `status: "fail"` or `status: "selector_not_found"` — do not touch `status: "pass"` rows

Record what you need to implement/fix:
```
Properties to implement/fix (N total):
  - [data-testid="filter-sidebar"]: background-color → rgb(255,255,255)
  - [data-testid="filter-sidebar"]: padding-left → 16px
  - [data-testid="filter-sidebar"]: padding-right → 16px
  ...
```

---

## Phase 2 — Locate the source file

1. Check `COMPONENT_REGISTRY_PATH` for `COMPONENT_NODE_ID` → if `filePath` is set, use it
2. If not in registry: grep `PROJECT_ROOT` for `data-testid="<kebab-case-figma-name>"`
3. If still not found and MODE = "build": ask the Orchestrator (one message): "Which feature/route should <componentName> live in?"

Once located (or decided), update `COMPONENT_REGISTRY_PATH` to add/update the entry:
```json
{
  "<COMPONENT_NODE_ID>": {
    "figmaName": "<layer name from Coverage Map>",
    "type": "component",
    "filePath": "<relative path from PROJECT_ROOT>",
    "parentFrame": "<frameId>"
  }
}
```

---

## Phase 3 — Read the source file (always before writing)

Read the source file identified in Phase 2. Also read its `.module.css` if one exists.

**Build Mode**: read the most similar existing component in the same feature directory to understand patterns, imports, and conventions.

**Upgrade Mode**: understand the current implementation so you know what to change and what to leave alone.

---

## Phase 4 — Plan before writing

Write a brief internal plan:

```
Mode: build | upgrade
File: <path>
data-testid needed: yes/no — "<testid-value>"

Properties to change:
  - <selector>: <property> → <expected value>
    Mechanism: <how to achieve this — dart prop, CSS class, CSS variable, etc.>
    Cross-check: <dart-knowledge.md says size="md" → 14px/16px ✓>
  ...

Files to modify: [list]
```

---

## Phase 5 — Write the code

Rules:

### Always use data-testid
Every component root element must have `data-testid="<kebab-case-of-figma-layer-name>"`. If the selector in the Coverage Map uses a `data-testid`, that testid must be present in the rendered HTML. Add it if missing.

### Cross-check every dart prop
Before writing any `size`, `lh`, `fw`, `gap`, `c`, or `variant` prop, look it up in `dart-knowledge.md`. Never assume dart matches Mantine defaults.

### Match Coverage Map exactly
Use the `expected` value in each Coverage Map row. Do not approximate. If `expected = "rgb(255,255,255)"` and you need a CSS value, either use the corresponding CSS variable if it exists, or use the hex equivalent `#ffffff`.

### Prefer CSS variables over hardcoded values
If the Coverage Map row has a `cssVar` (non-null), use the CSS variable in code rather than the fallback hex. This ensures the design token stays connected.

### Surgical changes only (Upgrade Mode)
In Upgrade Mode, only change the specific properties listed in FAIL rows. Do not reformat, reorganize, or "improve" other parts of the file.

### Code quality
- Server-only files: `.server.ts` suffix
- No barrel export violations
- Path aliases (`@client/*`, `@server/*`) over deep relative paths

---

## Phase 6 — Self-verify key properties

After writing, run a spot-check on the properties you were most uncertain about (dart props, CSS variables). Use the single-selector mode:

```bash
npx tsx <PIXEL_TWIN_ROOT>/scripts/computed-styles.ts \
  --url "<prerequisites.url from Coverage Map>" \
  --selector "<selector>" \
  --properties "<property1,property2>" \
  [--auth-helper "<auth path>"]
```

If a property does not match: fix it now, before writing the result file.

---

## Phase 7 — Write result file

Write `PROJECT_ROOT/.claude/pixel-twin/impl-result-<COMPONENT_NODE_ID>.json`:

```json
{
  "componentNodeId": "<COMPONENT_NODE_ID>",
  "mode": "build | upgrade",
  "filesChanged": [
    "client/features/RoiList/components/FilterSidebar.tsx",
    "client/features/RoiList/components/filter-sidebar.module.css"
  ],
  "testidsAdded": ["filter-sidebar", "apply-button"],
  "selfVerified": [
    { "selector": "[data-testid='filter-sidebar']", "property": "background-color", "expected": "rgb(255,255,255)", "actual": "rgb(255,255,255)", "pass": true }
  ],
  "notes": "<any dart-specific findings worth logging>"
}
```
```

- [x] **Step 2: Commit**

```bash
git add skills/agents/implementation-agent.md
git commit -m "feat: rewrite implementation-agent.md for v2 Coverage Map workflow"
```

---

## Task 6: Update code-review-agent.md — Add Track B

**Files:**
- Modify: `skills/agents/code-review-agent.md`

Add Track B: verify that implementation uses correct dart components and props, based on CodeConnect snippets from `get_design_context`.

Also update inputs to accept `FIGMA_FILE_KEY` and `COMPONENT_NODE_ID`.

- [x] **Step 1: Add FIGMA inputs to the Inputs block**

In `skills/agents/code-review-agent.md`, update the Inputs block:

```markdown
## Inputs (provided by the Orchestrator)

```
PROJECT_ROOT:       <absolute path to the project being reviewed>
CHANGED_FILES:      <newline-separated list of absolute file paths changed in this iteration>
FIGMA_FILE_KEY:     <Figma file key — for Track B CodeConnect check>
COMPONENT_NODE_ID:  <Figma node ID — for Track B CodeConnect check>
COMMANDS:
  typecheck: <command, e.g. "npm run typecheck">
  lint: <command, e.g. "npm run lint">
  test: <command, e.g. "npm run test">
DESIGN_SYSTEM: <package name, e.g. "@datavant/dart">
SAFETY_PROFILE: <"datavant-hipaa" | "basic" | "none">
CONVENTION_PROFILE: <"datavant" | "none">
```
```

- [x] **Step 2: Add Track B as a new Phase 2 check**

Add this as Check 5 in the Phase 2 section:

```markdown
### Check 5 — Track B: CodeConnect Props (dart component correctness)

Call `get_design_context` with `COMPONENT_NODE_ID` and `FIGMA_FILE_KEY`.

Look for CodeConnect snippets in the response — these appear as component usage examples (e.g. `<Button intent="default" variant="filled">`).

If CodeConnect snippets are present:
- Verify that `CHANGED_FILES` use the component name shown in the CodeConnect snippet (not a custom implementation)
- Verify that the props passed in the implementation match what CodeConnect specifies
- Flag mismatches as `blocker` if the wrong component is used entirely; `warning` if a prop is different

If no CodeConnect snippets in the response: skip Track B (CodeConnect is not set up for this component — not an error).

Category: `code-connect-props`
```

- [x] **Step 3: Update the output JSON schema to include the new category**

In the `phase2.issues` output block, add `"code-connect-props"` to the category enum:

```json
"category": "phi-pii-safety" | "design-system-reuse" | "convention" | "react" | "code-connect-props"
```

- [x] **Step 4: Commit**

```bash
git add skills/agents/code-review-agent.md
git commit -m "feat: add Track B (CodeConnect props check) to code-review-agent"
```

---

## Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [x] **Step 1: Update doc references in CLAUDE.md**

In `CLAUDE.md`:
- Replace `docs/design-spec.md` references with `docs/pixel-twin-v2-design.md`
- Add `css-variables.ts` to the scripts list
- Update the roadmap reference line

```markdown
## What this repo is

A Claude Code skill (plugin) distributed internally at Datavant. It is **not** an application — it contains:

- `skills/pixel-twin.md` — Main orchestrator skill (v2)
- `skills/agents/` — Sub-agent skill files (implementation, visual-review, code-review, dart-knowledge)
- `scripts/` — TypeScript utilities: `computed-styles.ts` (batch mode), `css-variables.ts`, `bounding-boxes.ts`, `screenshot.ts`
- `docs/pixel-twin-v2-design.md` — Current architecture specification
- `docs/design-spec.md` — v1 architecture (superseded, kept for reference)
- `CHANGELOG.md` — Version history

When in doubt about design decisions, read `docs/pixel-twin-v2-design.md` first.
```

Also update the Roadmap section at the bottom:

```markdown
## Roadmap

See `docs/pixel-twin-v2-design.md` for current architecture. See GitHub issues for v3/v4 feature plans.
```

- [x] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "chore: update CLAUDE.md references for v2"
```

---

## Task 8: Stage and commit design docs

- [x] **Step 1: Commit design docs and plan together**

```bash
cd /Users/aocheng.yu/Documents/pixel-twin
git add docs/pixel-twin-v2-design.md docs/pixel-twin-v2-plan.md README.md CHANGELOG.md
git commit -m "docs: add v2 design spec, implementation plan, and update README/CHANGELOG"
```

---

## Verification: End-to-End Test

After all tasks complete, run the full flow on the test frame:

```
/pixel-twin https://www.figma.com/design/Zh2dn0ePJAB3oDPxDc83Y0/Provider-Console---Integrated-ROI?node-id=209-11957&m=dev
```

Expected:
1. Coverage Map built with N rows
2. Each component processed sequentially through the agent loop
3. Final summary shows PASS counts and any FIGMA_CONFLICT items
4. Browser UI visually matches Figma frame
