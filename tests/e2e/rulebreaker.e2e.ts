import { expect, test, type Page } from '@playwright/test'

type ExportedExperiment = {
  schema: string
  engine: string
  tick: number
  bodies: Array<{ id: string; gravityScale: number }>
}

function readTick(text: string | null) {
  const match = /TICK\s+(\d+)/.exec(text ?? '')
  if (!match) throw new Error(`simulation clock was not readable: ${text ?? '<empty>'}`)
  return Number(match[1])
}

async function readCheckpointCount(page: Page) {
  const text = await page.getByRole('region', { name: 'Replay timeline' }).locator('.law-count').textContent()
  const match = /(\d+)\s+checkpoints/.exec(text ?? '')
  return Number(match?.[1] ?? 0)
}

test.describe('Rulebreaker browser release surface', () => {
  test('uses the real Chromium engine for prepare/apply, export/import, controls, replay, and diagnostics', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'The rules are yours to break.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply', exact: true }).first()).toBeEnabled()

    const diagnostics = page.locator('details.advanced-tools')
    const summary = diagnostics.locator('summary')
    await expect(summary).toContainText('Experiment tools & diagnostics')
    await expect(diagnostics).not.toHaveAttribute('open', '')
    await summary.click()
    await expect(diagnostics).toHaveAttribute('open', '')

    const prompt = page.getByRole('textbox', { name: 'Law prompt' })
    await prompt.fill('make the blue shapes rise')
    await page.getByRole('button', { name: 'Try prepared' }).click()
    await expect(page.getByText('Prepared interpretation ready.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Apply proposal' }).click()
    await expect(page.getByText('Law applied to the physics engine.', { exact: false })).toBeVisible()

    const experimentJson = diagnostics.getByRole('textbox', { name: 'Experiment JSON' })
    await diagnostics.getByRole('button', { name: 'Export JSON' }).click()
    await expect(experimentJson).toHaveValue(/rulebreaker\/experiment\/v1/)
    const exported = JSON.parse(await experimentJson.inputValue()) as ExportedExperiment
    expect(exported.schema).toBe('rulebreaker/experiment/v1')
    expect(exported.engine).toBe('rulebreaker/engine/v1')
    expect(exported.bodies.find(body => body.id === 'blue-a')?.gravityScale).toBe(-1)
    expect(exported.bodies.find(body => body.id === 'blue-b')?.gravityScale).toBe(-1)
    expect(exported.bodies.find(body => body.id === 'red-a')?.gravityScale).toBe(1)
    expect(exported.bodies.find(body => body.id === 'gold-a')?.gravityScale).toBe(1)

    const pauseButton = page.getByRole('button', { name: 'Pause room' })
    await pauseButton.click()
    const pausedTick = readTick(await page.locator('.clock-state').textContent())
    await page.getByRole('button', { name: 'Step 1 tick' }).click()
    await expect.poll(async () => readTick(await page.locator('.clock-state').textContent())).toBe(pausedTick + 1)
    await expect(page.locator('.clock-state')).toContainText('PAUSED')

    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(page.getByText('Room reset. Import an experiment snapshot here to restore it.', { exact: false })).toBeVisible()
    await diagnostics.getByRole('button', { name: 'Import into room' }).click()
    await expect(page.getByText('Experiment imported into the live room.', { exact: false })).toBeVisible()
    await expect(page.locator('.clock-state')).toContainText('PAUSED')

    await page.getByRole('button', { name: 'Resume room' }).click()
    await expect.poll(() => readCheckpointCount(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(3)

    const replay = page.getByRole('region', { name: 'Replay timeline' })
    const countBeforeBrowse = await readCheckpointCount(page)
    await replay.getByRole('button', { name: 'Previous' }).click()
    await expect(replay.getByText('paused · browse forward or resume to branch', { exact: false })).toBeVisible()
    expect(await readCheckpointCount(page)).toBe(countBeforeBrowse)
    await replay.getByRole('button', { name: 'Next' }).click()
    expect(await readCheckpointCount(page)).toBe(countBeforeBrowse)
    await replay.getByRole('button', { name: 'Previous' }).click()
    await replay.getByRole('button', { name: 'Latest' }).click()
    expect(await readCheckpointCount(page)).toBe(countBeforeBrowse)

    expect(pageErrors).toEqual([])
  })
})
