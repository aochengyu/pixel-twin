/**
 * pixel-twin auth helper for integrated-roi local dev.
 * Uses the mock /login route to create a session before screenshotting.
 */
import type { Page } from "@playwright/test"

export default async function auth(page: Page): Promise<void> {
  await page.goto("http://localhost:3000/login")
  await page.waitForSelector("text=Created session", { timeout: 10_000 })
  // Navigate to the main requests page so the session cookie is active
  await page.goto("http://localhost:3000/requests", { waitUntil: "networkidle" })
}
