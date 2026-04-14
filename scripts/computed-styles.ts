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
  --wait-for <selector>   Wait for this selector before extracting
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
          const props = await el.evaluate(
            (node, properties) => {
              const computed = window.getComputedStyle(node)
              return Object.fromEntries(
                (properties as string[]).map((p) => [p, computed.getPropertyValue(p).trim()])
              )
            },
            item.properties
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
          (el, props) => {
            const computed = window.getComputedStyle(el)
            if (props) {
              return Object.fromEntries(
                (props as string[]).map((p) => [p, computed.getPropertyValue(p).trim()])
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
