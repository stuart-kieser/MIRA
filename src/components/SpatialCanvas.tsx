import { SparkRenderer, SplatMesh, SplatFileType } from '@sparkjsdev/spark'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { SpaceProject } from '../types'

interface SpatialCanvasProps {
  project: SpaceProject
  focusSignal: number
  autoOrbit: boolean
  controlMode: ViewerControlMode
  onLoadState: (state: { loading: boolean; progress: number; error?: string }) => void
  onCanvasReady: (canvas: HTMLCanvasElement | null) => void
}

export type ViewerControlMode = 'orbit' | 'look'

type ColorTuple = [number, number, number]

const DEFAULT_CAMERA_POSITION = new THREE.Vector3(6.8, 4, 7.7)
const DEFAULT_TARGET = new THREE.Vector3(0, 1.25, -0.65)

function createSoftPointTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 31)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,.95)')
  gradient.addColorStop(0.72, 'rgba(255,255,255,.45)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

function buildRoomPointCloud() {
  let seed = 76451
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }

  const positions: number[] = []
  const colors: number[] = []
  const color = new THREE.Color()

  const addPoint = (x: number, y: number, z: number, rgb: ColorTuple, variation = 0.07) => {
    positions.push(x, y, z)
    color.setRGB(
      Math.max(0, Math.min(1, rgb[0] + (random() - 0.5) * variation)),
      Math.max(0, Math.min(1, rgb[1] + (random() - 0.5) * variation)),
      Math.max(0, Math.min(1, rgb[2] + (random() - 0.5) * variation)),
    )
    colors.push(color.r, color.g, color.b)
  }

  const plane = (
    count: number,
    origin: [number, number, number],
    axisA: [number, number, number],
    axisB: [number, number, number],
    rgb: ColorTuple,
  ) => {
    for (let index = 0; index < count; index += 1) {
      const a = random()
      const b = random()
      addPoint(
        origin[0] + axisA[0] * a + axisB[0] * b + (random() - 0.5) * 0.018,
        origin[1] + axisA[1] * a + axisB[1] * b + (random() - 0.5) * 0.018,
        origin[2] + axisA[2] * a + axisB[2] * b + (random() - 0.5) * 0.018,
        rgb,
      )
    }
  }

  const box = (
    count: number,
    center: [number, number, number],
    size: [number, number, number],
    rgb: ColorTuple,
  ) => {
    for (let index = 0; index < count; index += 1) {
      const face = Math.floor(random() * 6)
      let x = (random() - 0.5) * size[0]
      let y = (random() - 0.5) * size[1]
      let z = (random() - 0.5) * size[2]
      if (face < 2) x = (face === 0 ? -0.5 : 0.5) * size[0]
      else if (face < 4) y = (face === 2 ? -0.5 : 0.5) * size[1]
      else z = (face === 4 ? -0.5 : 0.5) * size[2]
      addPoint(center[0] + x, center[1] + y, center[2] + z, rgb, 0.11)
    }
  }

  const ellipsoid = (
    count: number,
    center: [number, number, number],
    radius: [number, number, number],
    rgb: ColorTuple,
  ) => {
    for (let index = 0; index < count; index += 1) {
      const theta = random() * Math.PI * 2
      const phi = Math.acos(2 * random() - 1)
      addPoint(
        center[0] + radius[0] * Math.sin(phi) * Math.cos(theta),
        center[1] + radius[1] * Math.cos(phi),
        center[2] + radius[2] * Math.sin(phi) * Math.sin(theta),
        rgb,
        0.14,
      )
    }
  }

  // Room shell: an open-front apartment corner.
  plane(9000, [-4, 0, -3.2], [8, 0, 0], [0, 0, 6.4], [0.64, 0.55, 0.42])
  plane(6500, [-4, 0, -3.2], [8, 0, 0], [0, 3.3, 0], [0.83, 0.80, 0.72])
  plane(4200, [-4, 0, -3.2], [0, 0, 6.4], [0, 3.3, 0], [0.77, 0.74, 0.67])
  plane(2500, [4, 0, -3.2], [0, 0, 3.6], [0, 3.3, 0], [0.80, 0.77, 0.70])
  // Warm rug.
  plane(2200, [-2.4, 0.035, -1.75], [4.6, 0, 0], [0, 0, 3.1], [0.57, 0.30, 0.22])
  // Sofa, cushions and coffee table.
  box(4300, [-1.7, 0.62, -2.55], [3.4, 0.72, 0.78], [0.22, 0.31, 0.28])
  box(1600, [-1.7, 1.15, -2.92], [3.45, 0.78, 0.25], [0.24, 0.34, 0.30])
  box(700, [-2.55, 1.13, -2.72], [0.58, 0.58, 0.25], [0.79, 0.58, 0.38])
  box(650, [-1.77, 1.13, -2.72], [0.58, 0.58, 0.25], [0.73, 0.69, 0.57])
  box(1100, [-1.25, 0.38, -0.5], [2.0, 0.14, 0.9], [0.37, 0.22, 0.13])
  box(320, [-2.0, 0.19, -0.82], [0.1, 0.38, 0.1], [0.28, 0.18, 0.11])
  box(320, [-0.5, 0.19, -0.82], [0.1, 0.38, 0.1], [0.28, 0.18, 0.11])
  box(320, [-2.0, 0.19, -0.18], [0.1, 0.38, 0.1], [0.28, 0.18, 0.11])
  box(320, [-0.5, 0.19, -0.18], [0.1, 0.38, 0.1], [0.28, 0.18, 0.11])
  // Sideboard and art.
  box(1800, [2.25, 0.55, -2.9], [2.2, 0.95, 0.45], [0.50, 0.31, 0.17])
  box(850, [2.2, 2.05, -3.13], [1.25, 1.05, 0.08], [0.76, 0.42, 0.28])
  // Window light frame on left wall.
  box(900, [-3.94, 2.05, -0.35], [0.07, 1.65, 2.05], [0.45, 0.67, 0.75])
  box(180, [-3.89, 2.05, -0.35], [0.08, 1.72, 0.06], [0.88, 0.86, 0.78])
  box(180, [-3.89, 2.05, -0.35], [0.08, 0.06, 2.12], [0.88, 0.86, 0.78])
  // Plant and pendant.
  box(700, [3.18, 0.38, 1.75], [0.62, 0.75, 0.62], [0.45, 0.28, 0.16])
  ellipsoid(680, [3.05, 1.25, 1.7], [0.35, 0.85, 0.24], [0.18, 0.39, 0.22])
  ellipsoid(680, [3.42, 1.35, 1.65], [0.30, 0.82, 0.21], [0.20, 0.43, 0.24])
  ellipsoid(680, [3.2, 1.55, 1.9], [0.25, 0.72, 0.20], [0.25, 0.48, 0.28])
  box(500, [0.25, 2.78, 0.0], [0.05, 0.62, 0.05], [0.25, 0.22, 0.18])
  ellipsoid(800, [0.25, 2.38, 0.0], [0.48, 0.28, 0.48], [0.82, 0.61, 0.34])

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()

  const texture = createSoftPointTexture()
  const material = new THREE.PointsMaterial({
    size: 0.047,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.91,
    alphaMap: texture,
    alphaTest: 0.025,
    depthWrite: false,
    blending: THREE.NormalBlending,
  })
  const pointCloud = new THREE.Points(geometry, material)
  pointCloud.rotation.y = -0.08
  return pointCloud
}

export function SpatialCanvas({
  project,
  focusSignal,
  autoOrbit,
  controlMode,
  onLoadState,
  onCanvasReady,
}: SpatialCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlModeRef = useRef(controlMode)
  const autoOrbitRef = useRef(autoOrbit)
  const applyControlModeRef = useRef<((mode: ViewerControlMode) => void) | null>(null)
  const syncLookDirectionRef = useRef<(() => void) | null>(null)

  controlModeRef.current = controlMode
  autoOrbitRef.current = autoOrbit

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let disposed = false
    let frame = 0
    let splat: SplatMesh | undefined
    let spark: SparkRenderer | undefined
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#08172d')
    scene.fog = new THREE.FogExp2('#08172d', 0.018)

    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)
    onCanvasReady(renderer.domElement)

    const camera = new THREE.PerspectiveCamera(54, mount.clientWidth / mount.clientHeight, 0.01, 1000)
    camera.position.copy(DEFAULT_CAMERA_POSITION)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.065
    controls.target.copy(DEFAULT_TARGET)
    controls.minDistance = 1.2
    controls.maxDistance = 18
    controls.maxPolarAngle = Math.PI * 0.88
    controlsRef.current = controls

    const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ')
    const lookForward = new THREE.Vector3()
    let lookYaw = 0
    let lookPitch = 0
    let lookPointerId: number | null = null
    let lookLastX = 0
    let lookLastY = 0
    let activeControlMode = controlModeRef.current

    const syncLookDirection = () => {
      lookEuler.setFromQuaternion(camera.quaternion, 'YXZ')
      lookYaw = lookEuler.y
      lookPitch = lookEuler.x
    }
    syncLookDirectionRef.current = syncLookDirection

    const finishLookDrag = () => {
      if (lookPointerId !== null && renderer.domElement.hasPointerCapture(lookPointerId)) {
        renderer.domElement.releasePointerCapture(lookPointerId)
      }
      lookPointerId = null
      renderer.domElement.style.cursor = activeControlMode === 'look' ? 'grab' : ''
    }

    const applyControlMode = (mode: ViewerControlMode) => {
      const previousMode = activeControlMode
      activeControlMode = mode

      if (mode === 'look') {
        controls.enabled = false
        controls.autoRotate = false
        syncLookDirection()
        renderer.domElement.style.cursor = 'grab'
        return
      }

      finishLookDrag()
      if (previousMode === 'look') {
        const distance = THREE.MathUtils.clamp(
          controls.target.distanceTo(camera.position) || 5,
          controls.minDistance,
          controls.maxDistance,
        )
        camera.getWorldDirection(lookForward)
        controls.target.copy(camera.position).addScaledVector(lookForward, distance)
      }
      controls.enabled = true
      controls.autoRotate = autoOrbitRef.current
      controls.update()
    }
    applyControlModeRef.current = applyControlMode
    applyControlMode(activeControlMode)

    const handleLookPointerDown = (event: PointerEvent) => {
      if (activeControlMode !== 'look' || event.button !== 0) return
      lookPointerId = event.pointerId
      lookLastX = event.clientX
      lookLastY = event.clientY
      renderer.domElement.setPointerCapture(event.pointerId)
      renderer.domElement.style.cursor = 'grabbing'
      event.preventDefault()
    }

    const handleLookPointerMove = (event: PointerEvent) => {
      if (activeControlMode !== 'look' || event.pointerId !== lookPointerId) return
      const deltaX = event.clientX - lookLastX
      const deltaY = event.clientY - lookLastY
      lookLastX = event.clientX
      lookLastY = event.clientY

      lookYaw -= deltaX * 0.004
      lookPitch = THREE.MathUtils.clamp(
        lookPitch - deltaY * 0.004,
        -Math.PI / 2 + 0.025,
        Math.PI / 2 - 0.025,
      )
      lookEuler.set(lookPitch, lookYaw, 0, 'YXZ')
      camera.quaternion.setFromEuler(lookEuler)
      event.preventDefault()
    }

    const handleLookPointerUp = (event: PointerEvent) => {
      if (event.pointerId === lookPointerId) finishLookDrag()
    }

    const handleLookWheel = (event: WheelEvent) => {
      if (activeControlMode !== 'look') return
      event.preventDefault()
      camera.getWorldDirection(lookForward)
      const travel = THREE.MathUtils.clamp(event.deltaY * 0.003, -1.2, 1.2)
      camera.position.addScaledVector(lookForward, -travel)
    }

    renderer.domElement.addEventListener('pointerdown', handleLookPointerDown)
    renderer.domElement.addEventListener('pointermove', handleLookPointerMove)
    renderer.domElement.addEventListener('pointerup', handleLookPointerUp)
    renderer.domElement.addEventListener('pointercancel', handleLookPointerUp)
    renderer.domElement.addEventListener('wheel', handleLookWheel, { passive: false })

    const animate = () => {
      if (disposed) return
      if (controls.enabled) controls.update()
      renderer.render(scene, camera)
      frame = window.requestAnimationFrame(animate)
    }

    const loadScene = async () => {
      onLoadState({ loading: true, progress: 6 })
      if (project.modelUrl) {
        try {
          spark = new SparkRenderer({ renderer })
          scene.add(spark)
          splat = new SplatMesh({
            url: project.modelUrl,
            fileName: project.modelFileName,
            // Private API URLs have no extension. Spark prioritizes the URL over fileName.
            fileType: ({ ply: SplatFileType.PLY, splat: SplatFileType.SPLAT, ksplat: SplatFileType.KSPLAT,
              spz: SplatFileType.SPZ, sog: SplatFileType.PCSOGSZIP } as Record<string, SplatFileType>)[project.modelFileName?.split('.').pop()?.toLowerCase() || ''],
            lod: true,
            onProgress: (event) => {
              if (disposed) return
              const progress = event.lengthComputable
                ? Math.min(94, Math.round((event.loaded / event.total) * 94))
                : 48
              onLoadState({ loading: true, progress })
            },
          })
          if (project.processingMode === 'remote') {
            // Nerfstudio exports Z-up PLY files; Three.js and its camera controls are Y-up.
            splat.rotation.x = -Math.PI / 2
          } else {
            // Preserve Spark's conventional orientation for directly imported splat files.
            splat.quaternion.set(1, 0, 0, 0)
          }
          scene.add(splat)
          await splat.initialized
          if (!disposed) onLoadState({ loading: false, progress: 100 })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'The model could not be decoded.'
          onLoadState({ loading: false, progress: 0, error: message })
        }
      } else {
        const points = buildRoomPointCloud()
        scene.add(points)
        window.setTimeout(() => {
          if (!disposed) onLoadState({ loading: false, progress: 100 })
        }, 720)
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      if (!mount.clientWidth || !mount.clientHeight) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    })
    resizeObserver.observe(mount)
    void loadScene()
    animate()

    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', handleLookPointerDown)
      renderer.domElement.removeEventListener('pointermove', handleLookPointerMove)
      renderer.domElement.removeEventListener('pointerup', handleLookPointerUp)
      renderer.domElement.removeEventListener('pointercancel', handleLookPointerUp)
      renderer.domElement.removeEventListener('wheel', handleLookWheel)
      controls.dispose()
      controlsRef.current = null
      cameraRef.current = null
      applyControlModeRef.current = null
      syncLookDirectionRef.current = null
      splat?.dispose()
      spark?.dispose()
      scene.traverse((object) => {
        if (object instanceof THREE.Points) {
          object.geometry.dispose()
          const material = object.material as THREE.PointsMaterial
          material.alphaMap?.dispose()
          material.dispose()
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
      onCanvasReady(null)
    }
  }, [project.id, project.modelFileName, project.modelUrl, project.processingMode, onCanvasReady, onLoadState])

  useEffect(() => {
    const controls = controlsRef.current
    const camera = cameraRef.current
    if (!controls || !camera) return
    camera.position.copy(DEFAULT_CAMERA_POSITION)
    if (controlModeRef.current === 'look') {
      camera.lookAt(DEFAULT_TARGET)
      syncLookDirectionRef.current?.()
    } else {
      controls.target.copy(DEFAULT_TARGET)
      controls.update()
    }
  }, [focusSignal])

  useEffect(() => {
    if (!controlsRef.current) return
    controlsRef.current.autoRotate = autoOrbit && controlModeRef.current === 'orbit'
    controlsRef.current.autoRotateSpeed = 0.55
  }, [autoOrbit])

  useEffect(() => {
    applyControlModeRef.current?.(controlMode)
  }, [controlMode])

  return <div className="spatial-canvas" data-control-mode={controlMode} ref={mountRef} />
}
