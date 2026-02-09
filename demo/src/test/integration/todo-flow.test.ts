import { test, expect } from '@playwright/test'
import { navigateTo, waitForZeroSync, addTodo, getTodoCount } from './helpers'

test.describe('todo flow', () => {
  test.setTimeout(45_000)

  test('seed data appears after sync', async ({ page }) => {
    await navigateTo(page, '/')
    await waitForZeroSync(page)

    const list = page.locator('[data-testid="todo-list"]')
    await expect(list).toBeVisible()
  })

  test('add todo and verify it appears', async ({ page }) => {
    await navigateTo(page, '/')
    await waitForZeroSync(page)

    const before = await getTodoCount(page)

    await addTodo(page, 'Test todo from playwright')

    const todoText = page.locator('text=Test todo from playwright')
    await expect(todoText).toBeVisible({ timeout: 5_000 })

    const after = await getTodoCount(page)
    expect(after).toBe(before + 1)
  })

  test('toggle todo completion', async ({ page }) => {
    await navigateTo(page, '/')
    await waitForZeroSync(page)

    await addTodo(page, 'Toggle me')
    const todoText = page.locator('text=Toggle me')
    await expect(todoText).toBeVisible()

    const todoItem = page.locator('[data-testid^="todo-item-"]', {
      has: page.locator('text=Toggle me'),
    })
    const checkbox = todoItem.locator('input[type="checkbox"]')

    await expect(checkbox).not.toBeChecked()
    await checkbox.click()
    await expect(checkbox).toBeChecked({ timeout: 3_000 })

    const span = todoItem.locator('span')
    await expect(span).toHaveCSS('text-decoration-line', 'line-through')
  })

  test('delete todo', async ({ page }) => {
    await navigateTo(page, '/')
    await waitForZeroSync(page)

    await addTodo(page, 'Delete me')
    const todoText = page.locator('text=Delete me')
    await expect(todoText).toBeVisible()

    const before = await getTodoCount(page)

    const todoItem = page.locator('[data-testid^="todo-item-"]', {
      has: page.locator('text=Delete me'),
    })
    const deleteBtn = todoItem.locator('button:has-text("✕")')
    await deleteBtn.click()

    await expect(todoText).not.toBeVisible({ timeout: 5_000 })

    const after = await getTodoCount(page)
    expect(after).toBe(before - 1)
  })

  test('todo persists after page reload', async ({ page }) => {
    await navigateTo(page, '/')
    await waitForZeroSync(page)

    const uniqueText = `Persistent todo ${Date.now()}`
    await addTodo(page, uniqueText)

    const todoText = page.locator(`text=${uniqueText}`)
    await expect(todoText).toBeVisible()

    await page.reload({ waitUntil: 'networkidle' })
    await waitForZeroSync(page)

    await expect(page.locator(`text=${uniqueText}`)).toBeVisible({ timeout: 10_000 })
  })

  test('multiple todos in correct order', async ({ page }) => {
    await navigateTo(page, '/')
    await waitForZeroSync(page)

    await addTodo(page, 'First todo')
    await addTodo(page, 'Second todo')
    await addTodo(page, 'Third todo')

    const items = page.locator('[data-testid^="todo-item-"]')
    const firstItem = items.first()
    await expect(firstItem.locator('span')).toContainText('Third todo')
  })
})
