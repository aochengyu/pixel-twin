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
        Empty string means the variable is not defined on :root (not an error).

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
