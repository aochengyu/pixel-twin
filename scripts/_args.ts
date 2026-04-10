/**
 * Minimal CLI argument parser shared by all pixel-twin scripts.
 * Parses --key value and --flag (boolean) arguments.
 */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith("--")) {
        result[key] = next
        i++
      } else {
        result[key] = true
      }
    }
  }
  return result
}

export function die(message: string): never {
  console.error(JSON.stringify({ error: "Fatal", message }))
  process.exit(1)
}
