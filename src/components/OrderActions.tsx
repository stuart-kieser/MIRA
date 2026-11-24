import { useState } from 'react'
import { adminApi, type AdminScan } from '../services/admin'

export function OrderActions({ scan, onUpdated }: { scan: AdminScan; onUpdated: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = !scan.deleted_at && ['queued', 'processing', 'uploading'].includes(scan.status)
  const canUpload = !scan.deleted_at && !scan.has_model && ['queued', 'processing', 'completed'].includes(scan.status)
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try { await action(); setFile(null); await onUpdated() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update order.') }
    finally { setBusy(false) }
  }
  return <div className="order-actions">
    <small>Order {scan.id}</small>
    {scan.source_filename ? <a href={`/api/admin/scans/${scan.id}/source`}>Download {scan.source_filename.endsWith('.miracapture') ? 'tracked capture' : 'video'} · {scan.source_filename}</a> : <small>Legacy order: source remains on the original worker.</small>}
    {scan.has_model && <a href={`/api/admin/scans/${scan.id}/model`}>Download finished splat</a>}
    {active && <>
      {scan.status !== 'processing' && <button disabled={busy} onClick={() => void run(() => adminApi.scanStatus(scan.id, 'processing'))}>Mark processing</button>}
      <button disabled={busy} onClick={() => {
        const reason = window.prompt(`Why did “${scan.name}” fail? This reason is shown to the customer.`)
        if (reason?.trim()) void run(() => adminApi.scanStatus(scan.id, 'failed', reason))
      }}>Mark failed</button>
    </>}
    {canUpload && <>
      <label>Finished splat for {scan.name}
        <input type="file" accept=".ply,.splat,.ksplat,.spz,.sog" disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] || null); setError('') }} />
      </label>
      <button disabled={busy || !file} onClick={() => {
        if (!file) return
        if (file.size > 1.5 * 1024 ** 3) { setError('The splat must be smaller than 1.5 GB.'); return }
        void run(() => adminApi.uploadModel(scan.id, file))
      }}>{busy ? 'Saving…' : 'Upload and complete order'}</button>
    </>}
    {scan.status === 'failed' && scan.entitlement_type === 'credit' && !scan.credit_refunded_at && <button disabled={busy} onClick={() => void run(() => adminApi.refundScanCredit(scan.id))}>Return scan credit</button>}
    {scan.credit_refunded_at && <small>Credit returned</small>}
    {scan.status === 'failed' && scan.entitlement_type === 'free' && <small>Free allowance restored</small>}
    {error && <p role="alert" className="admin-error-copy">{error}</p>}
  </div>
}
