import { test, expect } from '@playwright/test'
import { navigateTo, waitForZeroSync, addTodo } from './helpers'

test.describe('zero sync', () => {
  test.setTimeout(60_000)

  test('changes sync between two tabs', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()
    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    await navigateTo(page1, '/')
    await navigateTo(page2, '/')
    await waitForZeroSync(page1)
    await waitForZeroSync(page2)

    const uniqueText = `Sync test ${Date.now()}`
    await addTodo(page1, uniqueText)

    await expect(page1.locator(`text=${uniqueText}`)).toBeVisible()

    // verify it syncs to the second tab via zero-cache
    await expect(page2.locator(`text=${uniqueText}`)).toBeVisible({
      timeout: 15_000,
    })

    await context1.close()
    await context2.close()
  })

  test('rapid sequential inserts all sync', async ({ page }) => {
    await navigateTo(page, '/')
    await waitForZeroSync(page)

    const prefix = `Rapid ${Date.now()}`
    for (let i = 0; i < 5; i++) {
      await addTodo(page, `${prefix} item ${i}`)
    }

    for (let i = 0; i < 5; i++) {
      await expect(page.locator(`text=${prefix} item ${i}`)).toBeVisible({
        timeout: 10_000,
      })
    }
  })
})
