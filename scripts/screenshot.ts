#!/usr/bin/env tsx
/**
 * pixel-twin: screenshot utility
 *
 * Captures a screenshot of a DOM element or full page using Playwright.
 * Output image is always PNG.
 *
 * Usage:
 *   tsx scripts/screenshot.ts --url <url> --out <path> [options]
 *
 * stdout: JSON { path, width, height }
 * stderr: JSON { error, message }
 */

import { chromium, type Page } from "@playwright/test"
import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"
import { parseArgs, die } from "./_args.js"

const HELP = `
pixel-twin: screenshot utility

Usage:
  tsx scripts/screenshot.ts --url <url> --out <path> [options]

Required:
  --url <url>           Page URL to navigate to
  --out <path>          Output PNG file path

Options:
  --selector <css>      Screenshot this element only (default: full page)
  --wait-for <css>      Wait for selector before screenshotting (defaults to --selector)
  --auth-helper <path>  Path to a .ts file exporting: default async (page: Page) => void
  --full-page           Capture full scrollable page (ignored when --selector is set)
  --help                Show this help

stdout: JSON { path, width, height }
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
  const outPath = args["out"] as string | undefined
  const selector = args["selector"] as string | undefined
  const authHelperPath = args["auth-helper"] as string | undefined
  const fullPage = Boolean(args["full-page"])
  const waitFor = (args["wait-for"] as string | undefined) ?? selector

  if (!url) die("--url is required")
  if (!outPath) die("--out is required")

  const resolvedOut = path.resolve(outPath)
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true })

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()

    if (authHelperPath) {
      const authFn = await loadAuthHelper(authHelperPath)
      await authFn(page)
    }

    await page.goto(url, { waitUntil: "networkidle" })

    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: 15_000 })
    }

    let width: number
    let height: number

    if (selector) {
      const locator = page.locator(selector).first()
      await locator.screenshot({ path: resolvedOut })
      const box = await locator.boundingBox()
      width = Math.round(box?.width ?? 0)
      height = Math.round(box?.height ?? 0)
    } else {
      await page.screenshot({ path: resolvedOut, fullPage })
      const viewport = page.viewportSize()
      width = viewport?.width ?? 0
      height = viewport?.height ?? 0
    }

    console.log(JSON.stringify({ path: resolvedOut, width, height }))
  } finally {
    await browser.close()
  }
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err))
  console.error(JSON.stringify({ error: e.constructor.name, message: e.message }))
  process.exit(1)
})
