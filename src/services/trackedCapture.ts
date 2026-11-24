interface XrCamera { width: number; height: number }

interface XrView {
  camera?: XrCamera
  projectionMatrix: Float32Array
  transform: { inverse: { orientation: DOMPointReadOnly; position: DOMPointReadOnly } }
}

interface XrFrame {
  getViewerPose(reference: EventTarget): { views: XrView[]; emulatedPosition: boolean } | null
}

interface XrLayer { framebuffer: WebGLFramebuffer }

interface XrSession extends EventTarget {
  end(): Promise<void>
  updateRenderState(state: { baseLayer: XrLayer }): void
  requestReferenceSpace(type: 'local'): Promise<EventTarget>
  requestAnimationFrame(callback: (time: number, frame: XrFrame) => void): number
  cancelAnimationFrame(handle: number): void
}

interface XrBinding {
  getCameraImage(camera: XrCamera): WebGLTexture | null
}

const xrWindow = window as Window & {
  XRWebGLLayer?: new (session: XrSession, gl: WebGLRenderingContext) => XrLayer
  XRWebGLBinding?: new (session: XrSession, gl: WebGLRenderingContext) => XrBinding
}
const xrNavigator = navigator as Navigator & {
  xr?: {
    isSessionSupported(mode: 'immersive-ar'): Promise<boolean>
    requestSession(mode: 'immersive-ar', options: { requiredFeatures: string[]; domOverlay: { root: HTMLElement } }): Promise<XrSession>
  }
}

const minimumFrames = 12
const maximumFrames = 1200

interface CaptureFrame {
  image: Blob
  intrinsics: number[]
  rotation: number[]
  translation: number[]
}

function packCapture(width: number, height: number, frames: CaptureFrame[]) {
  const metadata = new TextEncoder().encode(JSON.stringify({
    width,
    height,
    frames: frames.map(({ image, ...geometry }) => ({ bytes: image.size, ...geometry })),
  }))
  const size = new DataView(new ArrayBuffer(4))
  size.setUint32(0, metadata.byteLength, true)
  return new File(['MIRACAP1', size.buffer, metadata, ...frames.map(({ image }) => image)],
    'Tracked walkthrough.miracapture', { type: 'application/octet-stream' })
}

export async function supportsTrackedCapture() {
  const Binding = xrWindow.XRWebGLBinding
  return Boolean(Binding && xrWindow.XRWebGLLayer && 'getCameraImage' in Binding.prototype
    && await xrNavigator.xr?.isSessionSupported('immersive-ar'))
}

export async function recordTrackedCapture(
  overlay: HTMLElement,
  finishButton: HTMLButtonElement,
  signal: AbortSignal,
  onStatus: (status: string) => void,
) {
  const xr = xrNavigator.xr
  const { XRWebGLLayer: Layer, XRWebGLBinding: Binding } = xrWindow
  if (!xr || !Layer || !Binding) throw new Error('Spatial tracking is unavailable in this browser.')
  const options = { requiredFeatures: ['camera-access', 'dom-overlay', 'local'], domOverlay: { root: overlay } }
  const session = await xr.requestSession('immersive-ar', options)
  const end = () => { void session.end().catch(() => undefined) }
  signal.addEventListener('abort', end, { once: true })
  finishButton.addEventListener('click', end)

  const frames: CaptureFrame[] = []
  let pending: Promise<void> | undefined
  let failure: Error | undefined
  let width = 0
  let height = 0
  let frameRequest = 0
  let ended = false
  const sessionEnded = new Promise<void>((resolve) => session.addEventListener('end', () => {
    ended = true
    resolve()
  }, { once: true }))

  const canvas = document.createElement('canvas')
  const gl = document.createElement('canvas').getContext('webgl', { alpha: true }) as
    (WebGLRenderingContext & { makeXRCompatible(): Promise<void> }) | null
  try {
    signal.throwIfAborted()
    const context = canvas.getContext('2d')
    if (!gl || !context) throw new Error('This device could not open the tracked camera.')
    await gl.makeXRCompatible()
    const layer = new Layer(session, gl)
    session.updateRenderState({ baseLayer: layer })
    const binding = new Binding(session, gl)
    const framebuffer = gl.createFramebuffer()
    if (!framebuffer) throw new Error('This device could not read camera frames.')
    const reference = await session.requestReferenceSpace('local')
    reference.addEventListener('reset', () => {
      failure = new Error('Tracking restarted. Try again with good lighting and slower movement.')
      end()
    })
    let lastSample = -Infinity
    let lastTracked = performance.now()
    let imageData: ImageData | undefined
    let pixels: Uint8Array<ArrayBuffer> | undefined
    let totalBytes = 0

    const capture = (time: number, frame: XrFrame) => {
      frameRequest = session.requestAnimationFrame(capture)
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      if (pending || time - lastSample < 500) return
      const pose = frame.getViewerPose(reference)
      const view = pose?.views[0]
      const camera = view?.camera
      if (!view || !camera || pose?.emulatedPosition) {
        onStatus(`Looking for tracking · ${frames.length} frames`)
        if (time - lastTracked > 20_000) end()
        return
      }
      lastSample = time

      try {
        const texture = binding.getCameraImage(camera)
        if (!texture) {
          if (time - lastTracked > 20_000) end()
          return
        }
        lastTracked = time
        if (camera.width !== width || camera.height !== height) {
          if (width !== 0) {
            end()
            return
          }
          width = camera.width
          height = camera.height
          if (width < 1 || height < 1 || width > 4096 || height > 4096) {
            throw new Error('This camera returned an unsupported frame size.')
          }
          canvas.width = width
          canvas.height = height
          pixels = new Uint8Array(width * height * 4)
          imageData = context.createImageData(width, height)
        }
        if (!pixels || !imageData) return
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error('This browser could not export tracked camera frames. Try video capture instead.')
        }
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        if (gl.getError() !== gl.NO_ERROR) throw new Error('The browser could not read a tracked frame. Try video capture instead.')
        const stride = width * 4
        for (let row = 0; row < height; row++) {
          const start = (height - row - 1) * stride
          imageData.data.set(pixels.subarray(start, start + stride), row * stride)
        }
        context.putImageData(imageData, 0, 0)

        // WebXR looks down -Z with +Y up. COLMAP uses +Z forward and +Y down.
        const inverse = view.transform.inverse
        const { x, y, z, w } = inverse.orientation
        const p = view.projectionMatrix
        const intrinsics = [p[0] * width / 2, p[5] * height / 2, (1 - p[8]) * width / 2, (1 + p[9]) * height / 2]
        const rotation = [-x, w, -z, y]
        const translation = [inverse.position.x, -inverse.position.y, -inverse.position.z]
        pending = new Promise<void>((resolve) => canvas.toBlob((image) => {
          if (image?.type === 'image/jpeg' && image.size <= 8 * 1024 ** 2) {
            frames.push({ image, intrinsics, rotation, translation })
            totalBytes += image.size
            onStatus(`${frames.length} tracked frames`)
            if (frames.length >= maximumFrames || totalBytes >= 512 * 1024 ** 2) end()
          } else {
            failure = new Error('A tracked frame could not be saved. Try video capture instead.')
            end()
          }
          resolve()
        }, 'image/jpeg', 0.9)).finally(() => { pending = undefined })
      } catch (error) {
        failure = error instanceof Error ? error : new Error('Tracked capture stopped unexpectedly.')
        end()
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0)
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer)
      }
    }
    if (!ended) frameRequest = session.requestAnimationFrame(capture)
    await sessionEnded
    await pending
    signal.throwIfAborted()
    if (failure) throw failure
    if (frames.length < minimumFrames) {
      throw new Error('Too few tracked frames were saved. Try a longer walkthrough or use video capture.')
    }
    return packCapture(width, height, frames)
  } finally {
    signal.removeEventListener('abort', end)
    finishButton.removeEventListener('click', end)
    if (!ended) {
      if (frameRequest) session.cancelAnimationFrame(frameRequest)
      end()
    }
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
