import { test, expect } from '@playwright/test'

test.describe('basic connectivity', () => {
  test('server responds on port 3456', async ({ request }) => {
    const response = await request.get('http://localhost:3456/')
    expect(response.status()).toBe(200)
  })

  test('health endpoint returns ok', async ({ request }) => {
    const response = await request.get('http://localhost:3456/api/health')
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.timestamp).toBeTruthy()
  })

  test('page loads without freezing', async ({ page }) => {
    page.setDefaultTimeout(10_000)
    await page.goto('http://localhost:3456/')
    await page.waitForSelector('[data-testid="app-container"]')
    const title = await page.textContent('h1')
    expect(title).toBe('zerolite demo')
  })
})
