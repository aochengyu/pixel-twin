#!/usr/bin/env tsx
/**
 * pixel-twin: computed styles + DOM metrics extractor
 *
 * Single mode:  --url <url> --selector <css> [--properties <list>]
 * Batch mode:   --url <url> --batch <json-file>
 *
 * Batch JSON input:  [{ "selector": string, "properties": string[] }]
 * Batch JSON output: [{ "selector": string, "properties": Record<string,string>, "error": string|null }]
 *
 * Single JSON output: Record<string, string>
 *
 * DOM metrics (routed automatically when property name matches):
 *   scrollWidth, clientWidth, scrollHeight, clientHeight
 *   offsetWidth, offsetHeight, offsetTop, offsetLeft
 *   boundingWidth, boundingHeight, boundingTop, boundingLeft, boundingRight, boundingBottom
 *   isOverflowingX  →  "true"/"false" (scrollWidth > clientWidth — detects text truncation)
 *   isOverflowingY  →  "true"/"false" (scrollHeight > clientHeight)
 */

/** Properties that must be read from the DOM element directly, not getComputedStyle. */
const DOM_METRIC_PROPS = new Set([
  "scrollWidth", "clientWidth", "scrollHeight", "clientHeight",
  "offsetWidth", "offsetHeight", "offsetTop", "offsetLeft",
  "boundingWidth", "boundingHeight", "boundingTop", "boundingLeft",
  "boundingRight", "boundingBottom",
  "isOverflowingX", "isOverflowingY",
  // Returns JSON-stringified array of direct children's data-testid values (in DOM order).
  // Elements without data-testid appear as "<tagname>:<position>", e.g. "div:3".
  // Used by Visual Review Agent to verify sibling order in structural rows.
  "childrenTestids",
  // Samples the center pixel color of an <img> element via Canvas API.
  // Returns "rgb(R, G, B)" on success, "cross-origin" if CORS blocks the read,
  // "not-an-img" if the element is not an <img>, or "canvas-unavailable" if 2D context failed.
  // Used to verify icon/image asset colors when CSS getComputedStyle cannot measure them.
  "imagePixelColor",
])

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
  --wait-for <selector>   Wait for this selector before extracting
  --properties <list>     Comma-separated CSS properties (single mode only)
  --interactions <json>   JSON array of page interactions to execute before measuring.
                          Each item: { "action": "click"|"waitFor"|"upload", "selector": "<css>", "waitFor"?: "<css>", "fileData"?: "<filename>" }
                          "upload": calls setInputFiles with a synthetic file buffer; fileData is the displayed filename.
                          Example: '[{"action":"click","selector":"[data-value=exceptions]"},{"action":"waitFor","selector":"[data-tab-id=exceptions]"}]'
  --viewport-width <px>   Viewport width (default: 1440)
  --viewport-height <px>  Viewport height (default: 900)
  --headed                Run browser in headed (non-headless) mode — use when interactions
                          require trusted user gestures (e.g. DateInput calendar open)
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
  const interactionsArg = args["interactions"] as string | undefined
  const headed = args["headed"] === true || args["headed"] === ""

  if (!url) die("--url is required")
  if (!selector && !batchFile) die("either --selector or --batch is required")

  type WaitState = "attached" | "visible" | "hidden" | "detached"
  type Interaction =
    | { action: "click"; selector: string; waitFor?: string }
    | { action: "waitFor"; selector: string; state?: WaitState }
    | { action: "upload"; selector: string; fileData?: string; waitFor?: string }

  const interactions: Interaction[] = interactionsArg
    ? (JSON.parse(interactionsArg) as Interaction[])
    : []

  const browser = await chromium.launch({ headless: !headed })
  try {
    const context = await browser.newContext({ viewport: { width: viewportWidth, height: viewportHeight } })
    const page = await context.newPage()

    if (authHelperPath) {
      const authFn = await loadAuthHelper(authHelperPath)
      await authFn(page)
    }

    await page.goto(url!, { waitUntil: "networkidle" })

    // Execute any pre-measurement interactions (e.g. click a tab, wait for content)
    for (const interaction of interactions) {
      if (interaction.action === "click") {
        await page.click(interaction.selector)
        if (interaction.waitFor) {
          await page.waitForSelector(interaction.waitFor, { timeout: 15_000 })
        }
      } else if (interaction.action === "waitFor") {
        await page.waitForSelector(interaction.selector, {
          timeout: 15_000,
          state: interaction.state ?? "attached",
        })
      } else if (interaction.action === "upload") {
        // Upload a minimal synthetic file — verifies the UI state after file selection,
        // not actual file content. fileData is used as the displayed filename.
        const fileName = interaction.fileData ?? "test-file.pdf"
        const mimeType = fileName.endsWith(".pdf") ? "application/pdf" : "application/octet-stream"
        const minimalPdfBytes = Buffer.from("%PDF-1.4 1 0 obj<</Type /Catalog>>endobj\n%%EOF")
        await page.setInputFiles(interaction.selector, {
          name: fileName,
          mimeType,
          buffer: minimalPdfBytes,
        })
        if (interaction.waitFor) {
          await page.waitForSelector(interaction.waitFor, { timeout: 15_000 })
        }
      }
    }

    if (batchFile) {
      // --- Batch mode ---
      const items: BatchItem[] = JSON.parse(readFileSync(batchFile, "utf-8"))

      if (waitForSelector) {
        await page.waitForSelector(waitForSelector, { timeout: 15_000 })
      } else if (items.length > 0) {
        await page.waitForSelector(items[0].selector, { timeout: 15_000 }).catch(() => {
          // Non-fatal: first selector may not exist yet (new component in Build Mode)
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
          const DOM_METRICS = ["scrollWidth","clientWidth","scrollHeight","clientHeight","offsetWidth","offsetHeight","offsetTop","offsetLeft","boundingWidth","boundingHeight","boundingTop","boundingLeft","boundingRight","boundingBottom","isOverflowingX","isOverflowingY","childrenTestids","imagePixelColor"]
          const props = await el.evaluate(
            (node, [properties, domMetrics]) => {
              const computed = window.getComputedStyle(node)
              const rect = node.getBoundingClientRect()
              const result: Record<string, string> = {}
              for (const p of properties as string[]) {
                if ((domMetrics as string[]).includes(p)) {
                  if (p === "boundingWidth") result[p] = String(rect.width)
                  else if (p === "boundingHeight") result[p] = String(rect.height)
                  else if (p === "boundingTop") result[p] = String(rect.top)
                  else if (p === "boundingLeft") result[p] = String(rect.left)
                  else if (p === "boundingRight") result[p] = String(rect.right)
                  else if (p === "boundingBottom") result[p] = String(rect.bottom)
                  else if (p === "isOverflowingX") result[p] = String(node.scrollWidth > node.clientWidth)
                  else if (p === "isOverflowingY") result[p] = String(node.scrollHeight > node.clientHeight)
                  else if (p === "childrenTestids") {
                    const children = Array.from(node.children).map((child, i) => {
                      const testid = child.getAttribute("data-testid")
                      return testid ?? `${child.tagName.toLowerCase()}:${i + 1}`
                    })
                    result[p] = JSON.stringify(children)
                  }
                  else if (p === "imagePixelColor") {
                    if (!(node instanceof HTMLImageElement)) {
                      result[p] = "not-an-img"
                    } else if (!node.complete || node.naturalWidth === 0) {
                      result[p] = "not-loaded"
                    } else {
                      try {
                        const canvas = document.createElement("canvas")
                        canvas.width = node.naturalWidth
                        canvas.height = node.naturalHeight
                        const ctx = canvas.getContext("2d")
                        if (!ctx) {
                          result[p] = "canvas-unavailable"
                        } else {
                          ctx.drawImage(node, 0, 0)
                          const cx = Math.floor(node.naturalWidth / 2)
                          const cy = Math.floor(node.naturalHeight / 2)
                          const d = ctx.getImageData(cx, cy, 1, 1).data
                          result[p] = `rgb(${d[0]}, ${d[1]}, ${d[2]})`
                        }
                      } catch {
                        result[p] = "cross-origin"
                      }
                    }
                  }
                  else result[p] = String((node as unknown as Record<string,number>)[p] ?? "")
                } else {
                  result[p] = computed.getPropertyValue(p).trim()
                }
              }
              return result
            },
            [item.properties, DOM_METRICS] as [string[], string[]]
          )
          results.push({ selector: item.selector, properties: props as Record<string, string>, error: null })
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
          (el, [props, domMetricsList]) => {
            const computed = window.getComputedStyle(el)
            const rect = el.getBoundingClientRect()
            if (props) {
              const result: Record<string, string> = {}
              for (const p of props as string[]) {
                if ((domMetricsList as string[]).includes(p)) {
                  if (p === "boundingWidth") result[p] = String(rect.width)
                  else if (p === "boundingHeight") result[p] = String(rect.height)
                  else if (p === "boundingTop") result[p] = String(rect.top)
                  else if (p === "boundingLeft") result[p] = String(rect.left)
                  else if (p === "boundingRight") result[p] = String(rect.right)
                  else if (p === "boundingBottom") result[p] = String(rect.bottom)
                  else if (p === "isOverflowingX") result[p] = String(el.scrollWidth > el.clientWidth)
                  else if (p === "isOverflowingY") result[p] = String(el.scrollHeight > el.clientHeight)
                  else if (p === "childrenTestids") {
                    const children = Array.from(el.children).map((child, i) => {
                      const testid = child.getAttribute("data-testid")
                      return testid ?? `${child.tagName.toLowerCase()}:${i + 1}`
                    })
                    result[p] = JSON.stringify(children)
                  }
                  else if (p === "imagePixelColor") {
                    if (!(el instanceof HTMLImageElement)) {
                      result[p] = "not-an-img"
                    } else if (!el.complete || el.naturalWidth === 0) {
                      result[p] = "not-loaded"
                    } else {
                      try {
                        const canvas = document.createElement("canvas")
                        canvas.width = el.naturalWidth
                        canvas.height = el.naturalHeight
                        const ctx = canvas.getContext("2d")
                        if (!ctx) {
                          result[p] = "canvas-unavailable"
                        } else {
                          ctx.drawImage(el, 0, 0)
                          const cx = Math.floor(el.naturalWidth / 2)
                          const cy = Math.floor(el.naturalHeight / 2)
                          const d = ctx.getImageData(cx, cy, 1, 1).data
                          result[p] = `rgb(${d[0]}, ${d[1]}, ${d[2]})`
                        }
                      } catch {
                        result[p] = "cross-origin"
                      }
                    }
                  }
                  else result[p] = String((el as unknown as Record<string,number>)[p] ?? "")
                } else {
                  result[p] = computed.getPropertyValue(p).trim()
                }
              }
              return result
            }
            return Object.fromEntries(
              Array.from(computed).map((prop) => [
                prop,
                computed.getPropertyValue(prop).trim(),
              ])
            )
          },
          [specificProperties, Array.from(DOM_METRIC_PROPS)] as [string[] | null, string[]]
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
