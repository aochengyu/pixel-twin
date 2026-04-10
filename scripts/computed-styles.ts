#!/usr/bin/env tsx
/**
 * pixel-twin: computed styles extractor
 *
 * Extracts CSS computed styles for a DOM element using Playwright.
 * Uses window.getComputedStyle() — returns resolved, data-independent values.
 *
 * Usage:
 *   tsx scripts/computed-styles.ts --url <url> --selector <css> [options]
 *
 * stdout: JSON { [cssProperty: string]: string }
 * stderr: JSON { error, message }
 */

import { chromium, type Page } from "@playwright/test"
import path from "path"
import { pathToFileURL } from "url"
import { parseArgs, die } from "./_args.js"

const HELP = `
pixel-twin: computed-styles extractor

Usage:
  tsx scripts/computed-styles.ts --url <url> --selector <css> [options]

Required:
  --url <url>           Page URL to navigate to
  --selector <css>      CSS selector to extract styles from

Options:
  --auth-helper <path>  Path to a .ts file exporting: default async (page: Page) => void
  --properties <list>   Comma-separated CSS properties to extract (default: all)
  --help                Show this help

stdout: JSON { [cssProperty: string]: string }

Example — extract specific properties:
  tsx scripts/computed-styles.ts \\
    --url http://localhost:3000/details/1 \\
    --selector '[data-testid="request-sidebar"]' \\
    --properties "padding-left,padding-top,background-color,font-size"
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
  const selector = args["selector"] as string | undefined
  const authHelperPath = args["auth-helper"] as string | undefined
  const propertiesArg = args["properties"] as string | undefined

  if (!url) die("--url is required")
  if (!selector) die("--selector is required")

  const specificProperties = propertiesArg
    ? propertiesArg.split(",").map((p) => p.trim()).filter(Boolean)
    : null

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()

    if (authHelperPath) {
      const authFn = await loadAuthHelper(authHelperPath)
      await authFn(page)
    }

    await page.goto(url, { waitUntil: "networkidle" })
    await page.waitForSelector(selector, { timeout: 15_000 })

    const styles = await page
      .locator(selector)
      .first()
      .evaluate(
        (el, props) => {
          const computed = window.getComputedStyle(el)
          if (props) {
            return Object.fromEntries(
              props.map((p) => [p, computed.getPropertyValue(p).trim()])
            )
          }
          // Return all properties
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
  } finally {
    await browser.close()
  }
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err))
  console.error(JSON.stringify({ error: e.constructor.name, message: e.message }))
  process.exit(1)
})
