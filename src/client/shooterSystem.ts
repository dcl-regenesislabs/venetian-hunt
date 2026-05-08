import {
  engine, Transform, PlayerIdentityData,
  GltfContainer, ColliderLayer, Entity,
  inputSystem, InputAction, PointerEventType
} from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { room } from '../shared/messages'

const BULLET_SRC   = 'assets/scene/Models/Bullet.glb'
const BULLET_SPEED = 20    // units/sec
const BULLET_LIFE  = 2.5   // seconds
const HIT_RADIUS   = 1.2   // units

type BulletData = { entity: Entity; vx: number; vy: number; vz: number; lifetime: number }

let shooterActive = false
const bullets: BulletData[] = []

export function activateShooter()  { shooterActive = true }
export function deactivateShooter() {
  shooterActive = false
  for (const b of bullets) engine.removeEntity(b.entity)
  bullets.length = 0
}

engine.addSystem((dt: number) => {
  if (!shooterActive) return

  if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) {
    fireBullet()
  }

  const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]
    b.lifetime -= dt
    if (b.lifetime <= 0) {
      engine.removeEntity(b.entity)
      bullets.splice(i, 1)
      continue
    }

    const t = Transform.getMutable(b.entity)
    t.position = {
      x: t.position.x + b.vx * dt,
      y: t.position.y + b.vy * dt,
      z: t.position.z + b.vz * dt,
    }

    let hit = false
    for (const [, identity, transform] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
      if (identity.address.toLowerCase() === myAddress) continue
      const dx = transform.position.x - t.position.x
      const dy = transform.position.y - t.position.y
      const dz = transform.position.z - t.position.z
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < HIT_RADIUS) {
        room.send('shoot', { targetAddress: identity.address.toLowerCase() })
        engine.removeEntity(b.entity)
        bullets.splice(i, 1)
        hit = true
        break
      }
    }
    if (hit) continue
  }
})

function fireBullet() {
  const cam = Transform.getOrNull(engine.CameraEntity)
  if (!cam) return

  const fwd = Vector3.rotate(Vector3.Forward(), cam.rotation)

  const entity = engine.addEntity()
  GltfContainer.create(entity, {
    src: BULLET_SRC,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
  })
  Transform.create(entity, {
    position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
    scale: { x: 0.05, y: 0.05, z: 0.05 },
  })

  bullets.push({ entity, vx: fwd.x * BULLET_SPEED, vy: fwd.y * BULLET_SPEED, vz: fwd.z * BULLET_SPEED, lifetime: BULLET_LIFE })
}
