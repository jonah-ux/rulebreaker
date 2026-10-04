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
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('requestfailed', request => failedRequests.push(request.url()))

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
    await expect(page.getByText('Ceiling expedition complete', { exact: true })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Pause room' }).click()

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

    const pausedTick = exported.tick
    await expect.poll(async () => readTick(await page.locator('.clock-state').textContent())).toBe(pausedTick)
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
    await page.getByRole('button', { name: 'Pause room' }).click()

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
    expect(consoleErrors).toEqual([])
    expect(failedRequests).toEqual([])
  })

  test('restores custom scope, expires a freeze without overwriting it, and protects operator access', async ({ page, request }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Apply', exact: true }).first()).toBeEnabled()
    const diagnostics = page.locator('details.advanced-tools')
    await diagnostics.locator('summary').click()
    await page.getByRole('button', { name: 'Pause room' }).click()
    await diagnostics.getByRole('button', { name: 'Export JSON' }).click()
    const text = diagnostics.getByRole('textbox', { name: 'Experiment JSON' })
    await expect(text).toHaveValue(/rulebreaker\/experiment\/v1/)
    const custom = JSON.parse(await text.inputValue()) as ExportedExperiment
    custom.bodies.find(body => body.id === 'blue-a')!.gravityScale = -0.5
    await text.fill(JSON.stringify(custom))
    await diagnostics.getByRole('button', { name: 'Import into room' }).click()
    await expect(page.locator('.object-button').filter({ hasText: 'Blue prism A' })).toContainText('gravity -0.5')
    await expect(page.locator('.laws-panel')).toContainText('CUSTOM')
    await page.locator('.object-button').filter({ hasText: 'Blue prism A' }).click()
    await page.getByRole('button', { name: 'Freeze Blue prism A for 3 seconds', exact: true }).click()
    await expect(page.locator('.frozen-strip')).toBeVisible()
    await page.getByRole('button', { name: 'Resume room' }).click()
    await expect(page.locator('.frozen-strip')).toBeHidden({ timeout: 12_000 })
    await expect(page.locator('.object-button').filter({ hasText: 'Blue prism A' })).toContainText('gravity -0.5')
    await expect(page.locator('.object-button').filter({ hasText: 'Blue prism B' })).toContainText('gravity 1')
    await page.locator('.provider-tools > summary').click()
    await expect(page.getByRole('button', { name: 'Ask live AI' })).toBeDisabled()
    await page.getByRole('textbox', { name: 'Operator access token' }).fill('fixture-access-token')
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Operator access token' })).toHaveValue('')
    const capabilities = await request.get('/api/capabilities')
    expect(capabilities.status()).toBe(200)
    expect(await capabilities.json()).toMatchObject({ capabilities: { prepared: true, liveAi: false } })
    const health = await request.get('/api/health')
    expect(health.status()).toBe(200)
    const healthPayload = await health.json()
    expect(healthPayload).toMatchObject({ status: 'ok', version: '0.1.0', capabilities: { prepared: true, liveAi: false } })
    if (process.env.RULEBREAKER_E2E_EXPECTED_REVISION) expect(healthPayload.revision).toBe(process.env.RULEBREAKER_E2E_EXPECTED_REVISION)
    const anonymous = await request.post('/api/interpret', { data: { prompt: 'blue shapes rise' } })
    expect(anonymous.status()).toBe(503)
    expect(await anonymous.json()).toMatchObject({ code: 'live_ai_disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })

  test('starts reduced-motion visitors paused and renders actual impact audio after activation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript(() => {
      const probe = window as Window & { __rulebreakerAudioPeak?: number }
      probe.__rulebreakerAudioPeak = 0
      const NativeContext = window.AudioContext
      window.AudioContext = class extends NativeContext {
        createGain() {
          const gain = super.createGain()
          const connect = gain.connect.bind(gain)
          gain.connect = ((destination: AudioNode, output?: number, input?: number) => {
            if (destination !== this.destination) return connect(destination, output, input)
            const analyser = this.createAnalyser()
            analyser.fftSize = 256
            connect(analyser)
            analyser.connect(destination)
            const samples = new Float32Array(analyser.fftSize)
            const timer = setInterval(() => {
              if (this.state === 'closed') { clearInterval(timer); return }
              analyser.getFloatTimeDomainData(samples)
              probe.__rulebreakerAudioPeak = Math.max(probe.__rulebreakerAudioPeak ?? 0, ...samples.map(Math.abs))
            }, 20)
            return destination
          }) as GainNode['connect']
          return gain
        }
      }
    })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Resume room' })).toBeEnabled()
    await expect(page.locator('.clock-state')).toContainText('PAUSED · TICK 0')
    await page.getByRole('button', { name: 'Enable audio', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Mute audio', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Listen', exact: true }).click()
    await page.getByRole('button', { name: 'Resume room' }).click()
    await expect.poll(() => page.evaluate(() => (window as Window & { __rulebreakerAudioPeak?: number }).__rulebreakerAudioPeak ?? 0), { timeout: 15_000 }).toBeGreaterThan(0.001)
    await page.getByRole('button', { name: 'Mute audio', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Enable audio', exact: true })).toBeVisible()
  })
})
