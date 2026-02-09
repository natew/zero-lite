import type { Page } from '@playwright/test'

const BASE_URL = 'http://localhost:3456'

export async function navigateTo(page: Page, path: string) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' })
}

export async function waitForZeroSync(page: Page, timeout = 10_000) {
  await page.waitForSelector(
    '[data-testid="todo-list"], [data-testid="empty-state"]',
    { timeout }
  )
}

export async function addTodo(page: Page, text: string) {
  await page.fill('[data-testid="todo-input"]', text)
  await page.click('[data-testid="todo-add"]')
  await page.waitForFunction(
    () => {
      const input = document.querySelector('[data-testid="todo-input"]') as HTMLInputElement
      return input?.value === ''
    },
    { timeout: 5_000 }
  )
}

export async function getTodoCount(page: Page): Promise<number> {
  const countText = await page.textContent('[data-testid="todo-count"]')
  return parseInt(countText || '0', 10)
}
