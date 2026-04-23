#!/usr/bin/env tsx
/**
 * pixel-twin: Coverage Map selector validator
 *
 * Navigates to prerequisites.url, waits for prerequisites.waitFor, then
 * checks every unique CSS selector in the Coverage Map against the live DOM.
 *
 * Reports:
 *   ✅  found       — exactly 1 element matched
 *   ⚠️  multiple    — >1 elements matched (may target wrong element)
 *   ❌  not-found   — 0 elements matched (stale selector or wrong page state)
 *
 * With --update: rows whose selector returns 0 elements are marked
 * status:"needs-verify" in the Coverage Map file.
 *
 * Usage:
 *   npx tsx scripts/validate-coverage-map.ts \
 *     --coverage-map <absolute-path> \
 *     [--auth-helper  <absolute-path>] \
 *     [--interactions '<json-array>']  \
 *     [--update]
 */

import { chromium } from "@playwright/test"
import { readFileSync, writeFileSync } from "fs"
import path from "path"
import { pathToFileURL } from "url"
import { parseArgs, die } from "./_args.js"

// ── types ─────────────────────────────────────────────────────────────────────

type CoverageRow = {
  selector: string
  property: string
  status?: string
  actual?: unknown
  note?: string
  figmaName?: string
}

type SelectorResult = {
  selector: string
  count: number
  verdict: "found" | "multiple" | "not-found"
}

type Interaction =
  | { action: "click"; selector: string; waitFor?: string }
  | { action: "waitFor"; selector: string; state?: "attached" | "visible" | "hidden" | "detached" }

// ── args ──────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2))

if (args["help"]) {
  console.log(`
pixel-twin: Coverage Map selector validator

Usage:
  tsx scripts/validate-coverage-map.ts --coverage-map <path> [options]

Required:
  --coverage-map <path>     Absolute path to coverage-map-<frameId>.json

Options:
  --auth-helper  <path>     Auth helper .ts file (same as computed-styles.ts)
  --interactions <json>     JSON array of interactions to run before checking selectors
                            Same format as computed-styles.ts --interactions
  --update                  Write needs-verify back to coverage map for not-found selectors
  --help                    Show this help
`)
  process.exit(0)
}

const coverageMapPath = args["coverage-map"] as string | undefined
const authHelperPath  = args["auth-helper"]  as string | undefined
const interactionsArg = args["interactions"] as string | undefined
const shouldUpdate    = args["update"] === true

if (!coverageMapPath) die("--coverage-map is required")

// ── load coverage map ─────────────────────────────────────────────────────────

const rawMap = JSON.parse(readFileSync(coverageMapPath!, "utf-8"))
const rows: CoverageRow[] = rawMap.rows ?? []
const prerequisites    = rawMap.prerequisites ?? {}
const url: string      = prerequisites.url
const waitFor: string  = prerequisites.waitFor
const viewport         = prerequisites.viewport ?? { width: 1440, height: 900 }

if (!url) die("prerequisites.url is missing from the coverage map")

// ── unique selectors (skip structure rows) ────────────────────────────────────

const uniqueSelectors = [
  ...new Set(
    rows
      .filter((r) => r.property !== "structure")
      .map((r) => r.selector)
      .filter(Boolean)
  ),
]

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const browser = await chromium.launch({ headless: true })

  try {
    const ctx = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    })
    const page = await ctx.newPage()

    // auth
    if (authHelperPath) {
      const mod = await import(pathToFileURL(path.resolve(authHelperPath!)).href)
      await mod.default(page)
    }

    await page.goto(url, { waitUntil: "networkidle" })

    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: 15_000 })
    }

    // optional interactions (e.g. click a tab before checking interactive-state selectors)
    const interactions: Interaction[] = interactionsArg
      ? (JSON.parse(interactionsArg) as Interaction[])
      : []

    for (const interaction of interactions) {
      if (interaction.action === "click") {
        await page.click(interaction.selector)
        if (interaction.waitFor) {
          await page.waitForSelector(interaction.waitFor, { timeout: 10_000 })
        }
      } else if (interaction.action === "waitFor") {
        await page.waitForSelector(interaction.selector, {
          timeout: 10_000,
          state: interaction.state ?? "attached",
        })
      }
    }

    // ── check selectors ───────────────────────────────────────────────────────

    const results: SelectorResult[] = []

    for (const selector of uniqueSelectors) {
      const count = await page.evaluate(
        (sel: string) => document.querySelectorAll(sel).length,
        selector
      )
      const verdict: SelectorResult["verdict"] =
        count === 0 ? "not-found" : count === 1 ? "found" : "multiple"
      results.push({ selector, count, verdict })
    }

    // ── print report ──────────────────────────────────────────────────────────

    const frameId = rawMap.frameId ?? path.basename(coverageMapPath!, ".json")
    console.log(`\n[validate] ${frameId} — selector check`)
    console.log(`  URL: ${url}`)
    if (interactions.length) console.log(`  Interactions: ${interactions.length} step(s) run`)
    console.log()

    const PAD = 64

    for (const r of results) {
      if (r.verdict === "found") {
        console.log(`  ✅  ${r.selector.padEnd(PAD)} 1 element`)
      } else if (r.verdict === "multiple") {
        console.log(`  ⚠️   ${r.selector.padEnd(PAD)} ${r.count} elements — verify correct target`)
      } else {
        console.log(`  ❌  ${r.selector.padEnd(PAD)} not found → needs-verify`)
      }
    }

    const foundCount    = results.filter((r) => r.verdict === "found").length
    const multipleCount = results.filter((r) => r.verdict === "multiple").length
    const notFoundCount = results.filter((r) => r.verdict === "not-found").length

    console.log()
    console.log(`  ✅  found (exact):     ${foundCount}`)
    console.log(`  ⚠️   multiple matches:  ${multipleCount}`)
    console.log(`  ❌  not found:         ${notFoundCount}`)
    console.log(`      total selectors:   ${results.length}`)

    // ── optional: update coverage map ────────────────────────────────────────

    if (shouldUpdate && notFoundCount > 0) {
      const notFoundSet = new Set(
        results.filter((r) => r.verdict === "not-found").map((r) => r.selector)
      )

      let updatedCount = 0
      for (const row of rawMap.rows as CoverageRow[]) {
        if (notFoundSet.has(row.selector) && row.status !== "pass") {
          row.status = "needs-verify"
          row.actual = null
          if (!row.note) {
            row.note =
              "Selector not found in DOM — stale or requires different page state"
          }
          updatedCount++
        }
      }

      writeFileSync(coverageMapPath!, JSON.stringify(rawMap, null, 2))
      console.log()
      console.log(`  Coverage Map updated: ${updatedCount} row(s) → needs-verify`)
      console.log(`  File: ${coverageMapPath}`)
    }

    if (notFoundCount > 0) {
      console.log()
      console.log(
        `  ⚠️  ${notFoundCount} selector(s) not found. Fix selectors or verify page state before running VRA.`
      )
    } else if (multipleCount === 0) {
      console.log()
      console.log(`  All selectors valid. Safe to run VRA.`)
    }

    process.exit(notFoundCount > 0 ? 1 : 0)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
