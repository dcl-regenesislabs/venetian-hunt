import { engine, Transform } from '@dcl/sdk/ecs'
import { movePlayerTo } from '~system/RestrictedActions'
import { getCurrentPhase } from './setup'

const WATER_Y_THRESHOLD = 1.5
const SPAWN = { x: 43.5, y: 2.75, z: 4 }

let teleporting = false

engine.addSystem(() => {
  const phase = getCurrentPhase()
  if (phase === 'playing' || phase === 'hiding') return

  const playerTransform = Transform.getOrNull(engine.PlayerEntity)
  if (!playerTransform) return

  if (playerTransform.position.y < WATER_Y_THRESHOLD) {
    if (teleporting) return
    teleporting = true
    movePlayerTo({ newRelativePosition: SPAWN }).then(() => {
      teleporting = false
    })
  } else {
    teleporting = false
  }
})
