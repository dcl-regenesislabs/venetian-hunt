import { engine, Transform, Entity } from '@dcl/sdk/ecs'
import { PROP_SPAWN_POINTS } from './propSpawnPoints'
import { applyPropComponents } from './propUtils'

const MIN_PROPS = 30

let spawnedProps: Entity[] = []

function mulberry32(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function spawnRandomProps(seed: number) {
  clearProps()
  const rng = mulberry32(seed)

  // Flatten all available slots into one pool
  const pool: { src: string; t: (typeof PROP_SPAWN_POINTS)[string][number] }[] = []
  for (const [src, transforms] of Object.entries(PROP_SPAWN_POINTS)) {
    for (const t of transforms) pool.push({ src, t })
  }

  // Shuffle the whole pool
  pool.sort(() => rng() - 0.5)

  // Pick between MIN_PROPS and the full pool, biased toward the upper end
  const count = MIN_PROPS + Math.floor(rng() * (pool.length - MIN_PROPS + 1))
  const picks = pool.slice(0, count)

  for (const { src, t } of picks) {
    const entity = engine.addEntity()
    applyPropComponents(entity, src, false)
    Transform.create(entity, {
      position: t.position,
      rotation: t.rotation,
      scale:    t.scale,
    })
    spawnedProps.push(entity)
  }

  console.log(`[Props] Spawned ${picks.length} props (pool=${pool.length})`)
}

export function clearProps() {
  for (const e of spawnedProps) engine.removeEntity(e)
  spawnedProps = []
}
