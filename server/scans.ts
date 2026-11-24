import { fileUpload, safeFilename, storagePath } from './storage.js'
import { unlink } from 'node:fs/promises'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { config, isQuality, qualityOrder } from './config.js'
import { pool } from './database.js'
import { PaymentRequiredError, reserveScan } from './entitlements.js'
import { requireAuth } from './middleware.js'
import { isTrackedCapture } from './tracked-capture.js'

const upload = fileUpload(['mp4', 'mov', 'm4v', 'webm', 'miracapture'], 3 * 1024 ** 3)

const createLimiter = rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: true, legacyHeaders: false })
export const scansRouter = Router()

interface ScanRow {
  id: string
  worker_job_id: string | null
  name: string
  location: string
  quality: string
  entitlement_type: string
  price_cents: number
  currency: string
  status: string
  progress: number
  stage: string
  model_storage_key: string | null
  model_filename: string | null
  splat_count: string | null
  metrics: unknown
  error: string | null
  created_at: Date
  updated_at: Date
  custom_tuning: boolean
  target_frames: number | null
  train_steps: number | null
  downscale_factor: 1 | 2 | 4 | 8 | null
}

function scanJson(row: ScanRow) {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    build_mode: row.quality,
    entitlement: row.entitlement_type,
    price_cents: row.price_cents,
    currency: row.currency,
    status: row.status,
    progress: row.progress,
    stage: row.stage,
    model_url: row.status === 'completed' ? `/api/scans/${row.id}/model` : undefined,
    model_filename: row.model_filename,
    splat_count: row.splat_count ? Number(row.splat_count) : undefined,
    metrics: row.metrics,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    custom_tuning: row.custom_tuning,
    target_frames: row.target_frames,
    train_steps: row.train_steps,
    downscale_factor: row.downscale_factor,
  }
}

async function ownedScan(scanId: string, userId: string) {
  const result = await pool.query<ScanRow>(
    `SELECT * FROM scans WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [scanId, userId],
  )
  return result.rows[0] || null
}

scansRouter.get('/health', async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ ok: true, processingMode: 'manual', build_modes: Object.fromEntries(qualityOrder.map((quality) => [quality, {}])), advanced_tuning: { max_target_frames: 1200 }, developmentBypass: config.devBypassPaywall })
})

scansRouter.get('/scans', requireAuth, async (req, res) => {
  const result = await pool.query<ScanRow>(
    `SELECT * FROM scans WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [req.authSession!.user.id],
  )
  res.json({ scans: result.rows.map(scanJson) })
})

scansRouter.post('/scans', createLimiter, requireAuth, upload.single('video'), async (req, res, next) => {
  const file = req.file
  let retained = false
  try {
    if (!file || !file.size) {
      res.status(400).json({ error: 'Choose a supported video or MIRA tracked capture.' })
      return
    }
    const name = String(req.body.name || '').trim()
    const location = String(req.body.location || '').trim()
    const quality = req.body.build_mode
    if (!name || name.length > 60 || location.length > 80 || !isQuality(quality)) {
      res.status(400).json({ error: 'A name and valid quality level are required.' })
      return
    }
    const hasTuning = ['target_frames', 'train_steps', 'downscale_factor'].some((key) => req.body[key] !== undefined)
    const tuningResult = hasTuning
      ? z.object({
          targetFrames: z.coerce.number().int().min(60).max(1200),
          trainSteps: z.coerce.number().int().min(1000).max(15000),
          downscaleFactor: z.coerce.number().refine((value): value is 1 | 2 | 4 | 8 => [1, 2, 4, 8].includes(value)),
        }).safeParse({
          targetFrames: req.body.target_frames,
          trainSteps: req.body.train_steps,
          downscaleFactor: req.body.downscale_factor,
        })
      : null
    if (tuningResult && !tuningResult.success) {
      res.status(400).json({ error: 'Advanced tuning must use 60–1,200 frames, 1,000–15,000 steps, and a 1×, 2×, 4×, or 8× downscale.' })
      return
    }
    const tuning = tuningResult?.data
    if (tuning && quality !== 'maximum') {
      res.status(400).json({ error: 'Advanced tuning uses the Maximum billing tier.' })
      return
    }
    if (file.originalname.toLowerCase().endsWith('.miracapture') && !await isTrackedCapture(file.path, file.size)) {
      res.status(400).json({ error: 'This MIRA tracked capture is incomplete or invalid.' })
      return
    }

    const reservation = await reserveScan({
      userId: req.authSession!.user.id, quality, name, location, tuning,
      source: { key: file.filename, filename: safeFilename(file.originalname), size: file.size },
    })
    retained = true
    const row = await ownedScan(reservation.scanId, req.authSession!.user.id)
    res.status(202).json(scanJson(row!))
  } catch (error) {
    if (error instanceof PaymentRequiredError) {
      res.status(402).json({
        error: error.message,
        paymentRequired: true,
        quality: error.quality,
        priceCents: error.priceCents,
        currency: config.BILLING_CURRENCY,
      })
      return
    }
    next(error)
  } finally {
    if (file && !retained) await unlink(file.path).catch(() => undefined)
  }
})

scansRouter.get('/scans/:id', requireAuth, async (req, res) => {
  const row = await ownedScan(String(req.params.id), req.authSession!.user.id)
  if (!row) {
    res.status(404).json({ error: 'Scan not found.' })
    return
  }
  res.json(scanJson(row))
})

scansRouter.get('/scans/:id/model', requireAuth, async (req, res, next) => {
  const row = await ownedScan(String(req.params.id), req.authSession!.user.id)
  if (!row?.model_storage_key || row.status !== 'completed') {
    res.status(404).json({ error: 'Finished model not found. A legacy model must be imported by an administrator.' })
    return
  }
  res.setHeader('Cache-Control', 'private, no-store')
  res.type('application/octet-stream')
  res.sendFile(storagePath(row.model_storage_key), (error) => { if (error) next(error) })
})

scansRouter.delete('/scans/:id', requireAuth, async (req, res) => {
  const result = await pool.query(
    `UPDATE scans SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [req.params.id, req.authSession!.user.id],
  )
  if (!result.rowCount) {
    res.status(404).json({ error: 'Scan not found.' })
    return
  }
  res.status(204).end()
})
