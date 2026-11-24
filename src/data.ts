import type { SpaceProject } from './types'

const now = new Date()
const daysAgo = (days: number) =>
  new Date(now.getTime() - days * 86_400_000).toISOString()

export const demoProjects: SpaceProject[] = [
  {
    id: 'demo-loft',
    name: 'Kloof Street Loft',
    location: 'Gardens, Cape Town',
    status: 'ready',
    progress: 100,
    stage: 'Ready to explore',
    createdAt: daysAgo(8),
    updatedAt: daysAgo(2),
    palette: 'clay',
    isDemo: true,
    rooms: 4,
    splatCount: '1.8M',
    processingMinutes: 34,
  },
  {
    id: 'demo-house',
    name: 'Sea Point Apartment',
    location: 'Sea Point, Cape Town',
    status: 'ready',
    progress: 100,
    stage: 'Ready to explore',
    createdAt: daysAgo(19),
    updatedAt: daysAgo(5),
    palette: 'sage',
    isDemo: true,
    rooms: 6,
    splatCount: '2.4M',
    processingMinutes: 42,
  },
  {
    id: 'demo-processing',
    name: 'Rosebank Studio',
    location: 'Rosebank, Johannesburg',
    status: 'processing',
    progress: 62,
    stage: 'Training Gaussian scene',
    createdAt: daysAgo(1),
    updatedAt: now.toISOString(),
    videoFileName: 'rosebank-walkthrough.mp4',
    palette: 'sky',
    isDemo: true,
    rooms: 2,
  },
]

export const captureTips = [
  'Move slowly and keep the camera steady',
  'Circle the object or follow an overlapping path through the scene',
  'Use even lighting and avoid moving subjects',
  'Film important details from more than one angle',
]
