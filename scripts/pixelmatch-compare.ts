#!/usr/bin/env tsx
/**
 * pixel-twin: pixelmatch comparison utility
 *
 * Compares two PNG images pixel-by-pixel and produces:
 *   - A diff image highlighting mismatched pixels
 *   - JSON statistics: diffPixels, totalPixels, diffPercent
 *
 * Both images must be the same dimensions. Resize before comparing if needed.
 *
 * Usage:
 *   tsx scripts/pixelmatch-compare.ts --actual <path> --expected <path> --diff <path> [options]
 *
 * stdout: JSON { diffPixels, totalPixels, diffPercent, diffImagePath }
 * stderr: JSON { error, message }
 */

import pixelmatch from "pixelmatch"
import { PNG } from "pngjs"
import fs from "fs"
import path from "path"
import { parseArgs, die } from "./_args.js"

const HELP = `
pixel-twin: pixelmatch comparison utility

Usage:
  tsx scripts/pixelmatch-compare.ts --actual <path> --expected <path> --diff <path> [options]

Required:
  --actual <path>     Path to actual screenshot PNG (app)
  --expected <path>   Path to expected PNG (Figma)
  --diff <path>       Output path for diff image PNG

Options:
  --threshold <n>     Per-pixel color difference threshold 0–1 (default: 0.1)
                      Lower = stricter. 0.1 is a good starting point.
  --help              Show this help

stdout: JSON { diffPixels, totalPixels, diffPercent, diffImagePath }

Note: images must be the same dimensions.
      diffPercent is rounded to 4 decimal places.
`

function readPng(filePath: string): PNG {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    die(`File not found: ${filePath}`)
  }
  return PNG.sync.read(fs.readFileSync(resolved))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args["help"]) {
    console.log(HELP)
    process.exit(0)
  }

  const actualPath = args["actual"] as string | undefined
  const expectedPath = args["expected"] as string | undefined
  const diffPath = args["diff"] as string | undefined
  const threshold = parseFloat((args["threshold"] as string | undefined) ?? "0.1")

  if (!actualPath) die("--actual is required")
  if (!expectedPath) die("--expected is required")
  if (!diffPath) die("--diff is required")

  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    die("--threshold must be a number between 0 and 1")
  }

  const actual = readPng(actualPath)
  const expected = readPng(expectedPath)

  if (actual.width !== expected.width || actual.height !== expected.height) {
    die(
      `Images must be the same dimensions. ` +
        `actual: ${actual.width}×${actual.height}, ` +
        `expected: ${expected.width}×${expected.height}`
    )
  }

  const { width, height } = actual
  const diff = new PNG({ width, height })

  const diffPixels = pixelmatch(
    actual.data,
    expected.data,
    diff.data,
    width,
    height,
    { threshold, includeAA: false }
  )

  const resolvedDiff = path.resolve(diffPath)
  fs.mkdirSync(path.dirname(resolvedDiff), { recursive: true })
  fs.writeFileSync(resolvedDiff, PNG.sync.write(diff))

  const totalPixels = width * height
  const diffPercent = parseFloat(((diffPixels / totalPixels) * 100).toFixed(4))

  console.log(
    JSON.stringify({ diffPixels, totalPixels, diffPercent, diffImagePath: resolvedDiff })
  )
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err))
  console.error(JSON.stringify({ error: e.constructor.name, message: e.message }))
  process.exit(1)
})
