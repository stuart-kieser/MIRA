import { expect, test, type Page } from '@playwright/test'

const password = 'secure-playwright-password-2026'

async function register(page: Page) {
  const email = `playwright-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`
  await page.goto('/register')
  await page.getByLabel('Full name').fill('Amina Test')
  await page.getByLabel('Email address').fill(email)
  await page.locator('input[type="password"]').nth(0).fill(password)
  await page.locator('input[type="password"]').nth(1).fill(password)
  await page.locator('.terms-check input').check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole('heading', { name: 'Welcome, Amina.' })).toBeVisible()
  return email
}

async function signInOrRegisterAdmin(page: Page, email: string) {
  await page.goto('/register')
  await page.getByLabel('Full name').fill('Mira Admin Test')
  await page.getByLabel('Email address').fill(email)
  await page.locator('input[type="password"]').nth(0).fill(password)
  await page.locator('input[type="password"]').nth(1).fill(password)
  await page.locator('.terms-check input').check()
  await page.getByRole('button', { name: 'Create account' }).click()
  const registered = await page.waitForURL((url) => url.pathname === '/app', { timeout: 8000 }).then(() => true).catch(() => false)
  if (registered) return
  await page.goto('/login?returnTo=/admin')
  await page.getByLabel('Email address').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL((url) => url.pathname === '/admin')
}

test('public website explains the product and pay-per-scan model', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Reconstruct the real world in 3D.' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'What you can capture' })).toContainText('Objects')
  await expect(page.getByRole('list', { name: 'What you can capture' })).toContainText('Outdoor scenes')
  await expect(page.getByRole('list', { name: 'What you can capture' })).toContainText('Interiors')
  await expect(page.getByText('Your first scene is on us.')).toBeVisible()
  await expect(page.getByText(/simple pay-per-scan/i)).toBeVisible()
  await page.getByRole('link', { name: 'Create your free scan' }).click()
  await expect(page.getByRole('heading', { name: 'Create your Mira account.' })).toBeVisible()
})

test('registers a user and protects the private workspace', async ({ page }) => {
  await page.route('**/api/health', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      worker: {
        build_modes: { quick: {}, preview: {}, balanced: {}, high: {}, maximum: {} },
        advanced_tuning: { max_target_frames: 1200 },
      },
    }),
  }))
  await page.goto('/app')
  await expect(page).toHaveURL(/\/login$/)
  await register(page)
  await expect(page.getByText('Your first scan starts with a phone video')).toBeVisible()
  await page.getByRole('button', { name: 'Usage & billing' }).click()
  await expect(page.getByRole('heading', { name: 'Usage & billing' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Order .* credit by EFT/ })).toHaveCount(5)
  await page.getByRole('button', { name: 'Order Balanced credit by EFT' }).click()
  await expect(page.getByText(/EFT order created/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Balanced' }).locator('xpath=ancestor::article')).toContainText('0 owned')
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible()
  await page.getByRole('button', { name: 'My scans' }).click()
  const newCapture = page.getByRole('button', { name: 'New capture' })
  if (await newCapture.count()) await newCapture.first().click()
  else await page.getByRole('button', { name: /Start a new scan/ }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'sunset-flat.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('test walkthrough'),
  })
  const slider = page.getByRole('slider', { name: 'Build quality' })
  await expect(slider).toHaveAttribute('aria-valuetext', 'Preview')
  await expect(page.locator('.build-quality-ticks button')).toHaveCount(5)
  await page.getByRole('button', { name: 'High', exact: true }).click()
  await expect(slider).toHaveAttribute('aria-valuetext', 'High')
  await page.getByRole('button', { name: /Advanced tuning/ }).click()
  const frames = page.getByRole('slider', { name: 'Sampled frames' })
  const steps = page.getByRole('slider', { name: 'Training steps' })
  const downscale = page.getByRole('slider', { name: 'Image downscale' })
  await frames.fill('1200')
  await steps.fill('2500')
  await downscale.fill('1')
  await expect(page.getByText('1200 frames', { exact: false })).toBeVisible()
  await expect(page.getByText('2,500 steps', { exact: false })).toBeVisible()
  await expect(page.getByText('4× downscale', { exact: false })).toBeVisible()
  await expect(page.getByText('Maximum billing tier')).toBeVisible()
  await expect(page.getByText('Your free scan', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Submit scan' })).toBeEnabled()
  const deniedRequest = page.waitForResponse((response) => response.url().endsWith('/api/admin/me'))
  await page.goto('/admin')
  await expect((await deniedRequest).status()).toBe(403)
  await expect(page.getByRole('heading', { name: 'Administrator access required' })).toBeVisible()
})

test('administrator can open the operations dashboard and audit a credit grant', async ({ page }) => {
  const email = 'admin-desktop-chromium@example.com'
  await signInOrRegisterAdmin(page, email)
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible()
  await expect(page.getByText('Manual fulfilment')).toBeVisible()
  await page.getByRole('button', { name: 'Pricing' }).click()
  await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible()
  await expect(page.getByLabel('Quick price')).toHaveValue(/\d+\.\d{2}/)
  await page.getByRole('button', { name: 'Save all prices' }).click()
  await expect(page.getByText('Customer token prices updated.')).toBeVisible()
  await page.getByRole('button', { name: 'Customers' }).click()
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible()
  await page.getByText('Amina Test', { exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Grant scan credits' })).toBeVisible()
  await page.getByRole('button', { name: 'Grant credit' }).click()
  await expect(page.getByText('1 Balanced credit granted.')).toBeVisible()
  await page.getByRole('button', { name: 'Close customer details' }).click()
  await page.getByRole('button', { name: 'Audit log' }).click()
  await expect(page.getByText('Credit Granted').first()).toBeVisible()
})

test('forgot-password flow returns a privacy-safe confirmation', async ({ page }) => {
  await page.goto('/forgot-password')
  await page.getByLabel('Email address').fill(`unknown-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()
  await expect(page.getByText(/If an account exists/)).toBeVisible()
})

test('customer and administrator complete the EFT and manual order screens', async ({ page, browser }, testInfo) => {
  test.setTimeout(90000)
  const email = await register(page)
  const name = `Manual space ${Date.now()}`
  await page.getByRole('button', { name: 'Usage & billing' }).click()
  await page.getByRole('button', { name: 'Order Balanced credit by EFT' }).click()
  await expect(page.getByText(/EFT order created/)).toBeVisible()
  await page.getByRole('button', { name: 'My scans' }).click()
  await page.getByRole('button', { name: /Start a new scan/ }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'customer-video.mp4', mimeType: 'video/mp4', buffer: Buffer.from('customer source video') })
  await page.getByLabel(/Scan name/).fill(name)
  await page.getByRole('button', { name: 'Submit scan' }).click()
  await expect(page.getByText('Submitted - awaiting processing')).toBeVisible()

  const adminContext = await browser.newContext()
  try {
    const admin = await adminContext.newPage()
    await signInOrRegisterAdmin(admin, 'admin-desktop-chromium@example.com')
    await admin.goto('/admin')
    await admin.getByRole('button', { name: 'Payments', exact: true }).click()
    await admin.getByPlaceholder('Search by name, email, or reference').fill(email)
    const receipt = admin.getByRole('row').filter({ hasText: email })
    admin.once('dialog', (dialog) => dialog.accept(`UI-${Date.now()}-${testInfo.project.name}`))
    await receipt.getByRole('button', { name: 'Confirm EFT' }).click()
    await expect(admin.getByText('EFT confirmed. Customer credit added.')).toBeVisible()
    await admin.getByRole('button', { name: 'Scans', exact: true }).click()
    await admin.getByPlaceholder('Search by name, email, or reference').fill(name)
    const order = admin.getByRole('row').filter({ hasText: name })
    const downloadPromise = admin.waitForEvent('download')
    await order.getByRole('link', { name: /Download video/ }).click()
    expect((await downloadPromise).suggestedFilename()).toBe('customer-video.mp4')
    await order.getByRole('button', { name: 'Mark processing' }).click()
    await expect(order.getByRole('button', { name: 'Mark processing' })).toHaveCount(0)
    const splat = Buffer.alloc(32)
    splat.writeFloatLE(0.1, 12); splat.writeFloatLE(0.1, 16); splat.writeFloatLE(0.1, 20)
    splat.fill(255, 24, 29); splat.fill(128, 29, 32)
    await order.locator('input[type="file"]').setInputFiles({ name: 'finished.splat', mimeType: 'application/octet-stream', buffer: splat })
    await order.getByRole('button', { name: 'Upload and complete order' }).click()
    await expect(order.getByRole('link', { name: 'Download finished splat' })).toBeVisible()
    await admin.screenshot({ path: `artifacts/manual-admin-${testInfo.project.name}.png`, fullPage: true })
    await page.reload()
    await page.getByRole('button', { name: `Open ${name}` }).click()
    await expect(page.locator('canvas').first()).toBeVisible()
    await expect(page.locator('.viewer-loading')).toHaveCount(0, { timeout: 20000 })
    await expect(page.locator('.viewer-error')).toHaveCount(0)
    await page.screenshot({ path: `artifacts/manual-viewer-${testInfo.project.name}.png`, fullPage: true })
  } finally { await adminContext.close() }
})
