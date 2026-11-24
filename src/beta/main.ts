import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { SparkRenderer, SplatMesh, SplatFileType } from '@sparkjsdev/spark'
import './style.css'

type Job = { id: string; name: string; status: string; stage: string; progress: number; live_preview?: boolean; error?: string; metrics?: { training_iteration: number; training_iterations: number; gaussian_count?: number | null; psnr?: number | null; elapsed_seconds?: number | null } | null }
type Preview = { available: boolean; revision?: number; step?: number; splats?: number; total_splats?: number; error?: string }
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const text = (id: string, value: string) => { el(id).textContent = value }
const error = (message = '') => { text('error', message); el('error').hidden = !message }
const message = (caught: unknown) => caught instanceof Error ? caught.message : String(caught)
const number = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—'
let token = ''
let selected: Job | null = null
let epoch = 0
let revision: number | null = null
let polling = false
let controller = new AbortController()
let connected = false
let loadingFinal = false
let downloading = false

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (token) headers.set('X-Mira-Worker-Token', token)
  const response = await fetch(path, { ...init, headers, cache: 'no-store' })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(response.status === 401 ? 'Worker token not accepted. Enter the token from your local .env and reconnect.' : typeof data?.detail === 'string' ? data.detail : `Worker returned ${response.status}.`)
  }
  return response
}

const viewport = el('viewport')
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10000)
camera.position.set(3, 2, 4)
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
viewport.prepend(renderer.domElement)
const spark = new SparkRenderer({ renderer })
scene.add(spark)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
let current: SplatMesh | null = null
let modelGeneration = 0
const resize = new ResizeObserver(() => {
  camera.aspect = viewport.clientWidth / viewport.clientHeight
  camera.updateProjectionMatrix()
  renderer.setSize(viewport.clientWidth, viewport.clientHeight)
})
resize.observe(viewport)
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera) })

function resetView() {
  if (!current) return
  current.updateMatrixWorld(true)
  const box = current.getBoundingBox().clone().applyMatrix4(current.matrixWorld)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(0.3, box.getSize(new THREE.Vector3()).length() / 2)
  controls.target.copy(center)
  camera.position.copy(center).add(new THREE.Vector3(1, 0.6, 1).normalize().multiplyScalar(radius * 2.7))
  camera.far = Math.max(1000, radius * 50)
  camera.updateProjectionMatrix()
  controls.update()
}

function clearScene() {
  modelGeneration++
  if (current) { scene.remove(current); current.dispose(); current = null }
  el('empty').hidden = false
}

async function showModel(bytes: ArrayBuffer, filename: string, expectedEpoch: number) {
  const generation = ++modelGeneration
  const types: Record<string, SplatFileType> = { splat: SplatFileType.SPLAT, ply: SplatFileType.PLY, ksplat: SplatFileType.KSPLAT, spz: SplatFileType.SPZ, sog: SplatFileType.PCSOGSZIP }
  const model = new SplatMesh({ fileBytes: new Uint8Array(bytes), fileType: types[filename.split('.').pop()?.toLowerCase() || ''], lod: false })
  model.rotation.x = -Math.PI / 2
  try {
    await model.initialized
    if (expectedEpoch !== epoch || generation !== modelGeneration) { model.dispose(); return false }
    const old = current
    current = model
    scene.add(model)
    if (old) { scene.remove(old); old.dispose() }
    else resetView()
    el('empty').hidden = true
    return true
  } catch (caught) { model.dispose(); throw caught }
}

function updateJob(job: Job) {
  selected = job
  text('scene-name', job.name)
  text('job-label', `Job ${job.id}`)
  text('status', job.status === 'completed' ? 'Completed' : job.status)
  text('stage', job.stage)
  text('progress-label', `${job.progress}%`)
  el<HTMLProgressElement>('progress').value = job.progress
  text('iteration', job.metrics ? `${number(job.metrics.training_iteration)} / ${number(job.metrics.training_iterations)}` : '—')
  text('gaussians', number(job.metrics?.gaussian_count))
  const psnr = job.metrics?.psnr
  text('psnr', typeof psnr === 'number' && Number.isFinite(psnr) ? psnr.toFixed(2) : '—')
  const elapsed = job.metrics?.elapsed_seconds
  text('elapsed', typeof elapsed === 'number' && Number.isFinite(elapsed) ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : '—')
  el<HTMLButtonElement>('download').disabled = downloading || job.status !== 'completed'
  el<HTMLButtonElement>('final').disabled = loadingFinal || job.status !== 'completed'
  const option = Array.from(el<HTMLSelectElement>('jobs').options).find((item) => item.value === job.id)
  if (option) option.text = `${job.name} · ${job.status}`
  text('empty-title', job.status === 'completed' ? 'Your finished scene is ready' : job.status === 'failed' ? 'This build stopped' : 'Waiting for the first splats')
  text('empty-copy', job.status === 'completed' ? 'Load the final model to explore the full result, or download the PLY.' : job.live_preview ? 'Camera matching runs first. Live snapshots begin when Gaussian training starts.' : 'This job was started without live previews. You can load its final model when it finishes. Start a new build here to watch training.')
  if (job.error) error(job.error)
}

async function poll() {
  if (!selected || polling) return
  polling = true
  const version = epoch
  const id = selected.id
  const signal = controller.signal
  try {
    const job: Job = await (await request(`/v1/reconstructions/${id}`, { signal })).json()
    if (version !== epoch) return
    updateJob(job)
    if (!job.error) error()
    if (!el<HTMLInputElement>('follow').checked || !job.live_preview) return
    const preview: Preview = await (await request(`/v1/reconstructions/${id}/preview`, { signal })).json()
    if (version !== epoch) return
    if (preview.error) { error(`Live preview stopped: ${preview.error}. Training can continue; the final PLY is still available when complete.`); return }
    if (preview.available && preview.revision !== undefined && preview.revision !== revision) {
      const response = await request(`/v1/reconstructions/${id}/preview/${preview.revision}`, { signal })
      const bytes = await response.arrayBuffer()
      if (version !== epoch || !el<HTMLInputElement>('follow').checked) return
      if (await showModel(bytes, 'preview.splat', version)) {
        revision = preview.revision
        text('scene-notice', `Live snapshot · step ${number(preview.step)} · ${number(preview.splats)} of ${number(preview.total_splats)} splats`)
      }
    }
  } catch (caught) {
    if (version === epoch && !signal.aborted) error(`${message(caught)} Retrying shortly; the last loaded scene is retained.`)
  } finally { polling = false }
}

function watch(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) { error('Choose a job or enter its 32-character worker ID.'); return }
  epoch++
  controller.abort()
  controller = new AbortController()
  revision = null
  clearScene()
  error()
  selected = { id, name: 'Connecting to job…', status: 'connecting', stage: 'Connecting', progress: 0 }
  updateJob(selected)
  el<HTMLInputElement>('follow').checked = true
  text('scene-notice', 'Orbit: drag · Pan: right-drag · Zoom: scroll')
  el<HTMLInputElement>('job-id').value = id
  void poll()
}

async function loadJobs() {
  const data: { jobs: Job[] } = await (await request('/v1/reconstructions')).json()
  const list = el<HTMLSelectElement>('jobs')
  list.replaceChildren(new Option('Choose a job', ''))
  data.jobs.forEach((job) => list.add(new Option(`${job.name} · ${job.status}`, job.id)))
  list.value = selected?.id || ''
}

el('connect').addEventListener('click', async () => {
  token = el<HTMLInputElement>('token').value.trim()
  error()
  try {
    const health = await (await request('/health')).json()
    if (!health.live_preview?.enabled) throw new Error('This worker needs the beta update. Finish active jobs, then rebuild the GPU worker.')
    await loadJobs()
    connected = true
    text('connection', 'Local worker connected')
    el<HTMLButtonElement>('start').disabled = false
  } catch (caught) { connected = false; el<HTMLButtonElement>('start').disabled = true; text('connection', 'Not connected'); error(message(caught)) }
})
el('jobs').addEventListener('change', () => { const id = el<HTMLSelectElement>('jobs').value; if (id) watch(id) })
el('watch').addEventListener('click', () => watch(el<HTMLInputElement>('job-id').value.trim()))
el('reset').addEventListener('click', resetView)
el('follow').addEventListener('change', () => { if (!el<HTMLInputElement>('follow').checked) modelGeneration++; void poll() })
el('custom').addEventListener('change', () => {
  const custom = el<HTMLInputElement>('custom').checked
  el('tuning').hidden = !custom
  el<HTMLSelectElement>('quality').disabled = custom
  if (custom) el<HTMLSelectElement>('quality').value = 'maximum'
})
el('upload').addEventListener('submit', async (event) => {
  event.preventDefault()
  const file = el<HTMLInputElement>('video').files?.[0]
  if (!file || !connected) return
  if (file.size > 3 * 1024 ** 3) { error('Choose a capture no larger than 3 GB.'); return }
  const form = new FormData()
  form.append('video', file)
  form.append('name', el<HTMLInputElement>('name').value.trim())
  form.append('build_mode', el<HTMLSelectElement>('quality').value)
  form.append('live_preview', 'true')
  if (el<HTMLInputElement>('custom').checked) {
    form.append('target_frames', el<HTMLInputElement>('frames').value)
    form.append('train_steps', el<HTMLInputElement>('steps').value)
    form.append('downscale_factor', el<HTMLSelectElement>('downscale').value)
  }
  el<HTMLButtonElement>('start').disabled = true
  text('start', 'Uploading capture…')
  error()
  try {
    const job: Job = await (await request('/v1/reconstructions', { method: 'POST', body: form })).json()
    watch(job.id)
    await loadJobs()
  } catch (caught) { error(message(caught)) }
  finally { el<HTMLButtonElement>('start').disabled = !connected; text('start', 'Build with live preview') }
})

el('local').addEventListener('change', async () => {
  const file = el<HTMLInputElement>('local').files?.[0]
  if (!file) return
  if (file.size > 1.5 * 1024 ** 3) { error('Choose a splat smaller than 1.5 GB.'); return }
  epoch++; controller.abort(); controller = new AbortController(); selected = null; revision = null
  const version = epoch
  clearScene(); error()
  text('scene-name', file.name); text('job-label', 'Local file · kept in this browser'); text('status', 'Local file')
  text('stage', 'Exploring a finished splat'); el<HTMLProgressElement>('progress').value = 100; text('progress-label', '100%')
  for (const id of ['iteration', 'gaussians', 'psnr', 'elapsed']) text(id, '—')
  el<HTMLButtonElement>('download').disabled = true; el<HTMLButtonElement>('final').disabled = true
  try { if (await showModel(await file.arrayBuffer(), file.name, version)) text('scene-notice', 'Local file · Orbit: drag · Pan: right-drag · Zoom: scroll') }
  catch (caught) { if (version === epoch) error(`Could not open this splat: ${message(caught)}`) }
})

el('final').addEventListener('click', async () => {
  if (!selected || selected.status !== 'completed' || loadingFinal) return
  loadingFinal = true
  modelGeneration++
  const version = epoch
  el<HTMLInputElement>('follow').checked = false
  el<HTMLButtonElement>('final').disabled = true
  text('final', 'Loading final model…')
  try {
    const response = await request(`/v1/reconstructions/${selected.id}/model`, { signal: controller.signal })
    if (await showModel(await response.arrayBuffer(), 'scene.ply', version)) text('scene-notice', 'Final model · full exported detail')
  } catch (caught) { if (version === epoch) error(message(caught)) }
  finally { loadingFinal = false; text('final', 'Load final model'); el<HTMLButtonElement>('final').disabled = selected?.status !== 'completed' }
})
el('download').addEventListener('click', async () => {
  if (!selected || selected.status !== 'completed' || downloading) return
  downloading = true
  const id = selected.id
  text('download', 'Downloading…')
  el<HTMLButtonElement>('download').disabled = true
  try {
    const blob = await (await request(`/v1/reconstructions/${id}/model`)).blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = `${id}-scene.ply`; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (caught) { error(message(caught)) }
  finally { downloading = false; text('download', 'Download final PLY'); el<HTMLButtonElement>('download').disabled = selected?.status !== 'completed' }
})
const timer = window.setInterval(() => { void poll() }, 4000)
window.addEventListener('pagehide', () => {
  clearInterval(timer); controller.abort(); clearScene(); resize.disconnect(); controls.dispose(); spark.dispose(); renderer.setAnimationLoop(null); renderer.dispose()
})
