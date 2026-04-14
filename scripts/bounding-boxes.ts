#!/usr/bin/env tsx
/**
 * pixel-twin: bounding-box fill checker
 *
 * Checks whether a child element visually fills its parent by comparing
 * getBoundingClientRect() on both. This catches bugs that getComputedStyle
 * alone cannot reveal — e.g. a background-colored div whose height: 100%
 * resolves to less than the TD height because the TD has unexpected padding.
 *
 * Usage:
 *   tsx scripts/bounding-boxes.ts \
 *     --url <url> \
 *     --parent <css-selector> \
 *     --child <css-selector> \
 *     [--auth-helper <path>]
 *
 * Output (stdout, JSON):
 *   {
 *     parent: { top, right, bottom, left, width, height },
 *     child:  { top, right, bottom, left, width, height },
 *     fill: {
 *       heightFills: boolean,    // child.height >= parent.height - 1px tolerance
 *       widthFills:  boolean,    // child.width  >= parent.width  - 1px tolerance
 *       heightGap:   number,     // parent.height - child.height (px; 0 = fills)
 *       widthGap:    number,     // parent.width  - child.width
 *       topGap:      number,     // child.top - parent.top  (gap at top edge)
 *       bottomGap:   number,     // parent.bottom - child.bottom (gap at bottom)
 *       verdict: "fills" | "partial" | "overflows"
 *     }
 *   }
 *
 * stderr: JSON { error, message }
 */

import { chromium, type Page } from "@playwright/test"
import path from "path"
import { pathToFileURL } from "url"
import { parseArgs, die } from "./_args.js"

const HELP = `
pixel-twin: bounding-box fill checker

Usage:
  tsx scripts/bounding-boxes.ts --url <url> --parent <selector> --child <selector> [options]

Required:
  --url <url>            Page URL to navigate to
  --parent <selector>    CSS selector for the parent (container) element
  --child <selector>     CSS selector for the child (content) element

Options:
  --auth-helper <path>   Path to a .ts file exporting: default async (page: Page) => void
  --tolerance <px>       Pixel tolerance for fill checks (default: 1)
  --help                 Show this help

stdout: JSON fill report
stderr: JSON { error, message }

Example — verify table row inner div fills the full TD height:
  tsx scripts/bounding-boxes.ts \\
    --url http://localhost:3000/requests \\
    --auth-helper scripts/auth-integrated-roi.ts \\
    --parent "tbody tr:first-child td:first-child" \\
    --child "tbody tr:first-child td:first-child > div"
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

type Rect = { top: number; right: number; bottom: number; left: number; width: number; height: number }

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args["help"]) {
    console.log(HELP)
    process.exit(0)
  }

  const url = args["url"] as string | undefined
  const parentSelector = args["parent"] as string | undefined
  const childSelector = args["child"] as string | undefined
  const authHelperPath = args["auth-helper"] as string | undefined
  const tolerance = parseFloat((args["tolerance"] as string | undefined) ?? "1")

  if (!url) die("--url is required")
  if (!parentSelector) die("--parent is required")
  if (!childSelector) die("--child is required")

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()

    if (authHelperPath) {
      const authFn = await loadAuthHelper(authHelperPath)
      await authFn(page)
    }

    await page.goto(url!, { waitUntil: "networkidle" })
    await page.waitForSelector(parentSelector!, { timeout: 15_000 })
    await page.waitForSelector(childSelector!, { timeout: 5_000 })

    const result = await page.evaluate(
      ([pSel, cSel, tol]) => {
        const parentEl = document.querySelector(pSel as string)
        const childEl = document.querySelector(cSel as string)

        if (!parentEl) return { error: `Parent not found: ${pSel}` }
        if (!childEl) return { error: `Child not found: ${cSel}` }

        const p = parentEl.getBoundingClientRect()
        const c = childEl.getBoundingClientRect()

        const tolerance = tol as number
        const heightGap = p.height - c.height
        const widthGap = p.width - c.width
        const topGap = c.top - p.top
        const bottomGap = p.bottom - c.bottom

        const heightFills = heightGap <= tolerance
        const widthFills = widthGap <= tolerance

        let verdict: "fills" | "partial" | "overflows"
        if (heightGap < -tolerance || widthGap < -tolerance) {
          verdict = "overflows"
        } else if (heightFills && widthFills) {
          verdict = "fills"
        } else {
          verdict = "partial"
        }

        return {
          parent: { top: p.top, right: p.right, bottom: p.bottom, left: p.left, width: p.width, height: p.height },
          child:  { top: c.top, right: c.right, bottom: c.bottom, left: c.left, width: c.width, height: c.height },
          fill: { heightFills, widthFills, heightGap, widthGap, topGap, bottomGap, verdict }
        }
      },
      [parentSelector, childSelector, tolerance]
    )

    if ("error" in result) {
      console.error(JSON.stringify({ error: "SelectorNotFound", message: result.error }))
      process.exit(1)
    }

    console.log(JSON.stringify(result, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err))
  console.error(JSON.stringify({ error: e.constructor.name, message: e.message }))
  process.exit(1)
})
