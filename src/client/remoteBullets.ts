import { engine, GltfContainer, ColliderLayer, Transform, Entity } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'

const BULLET_SRC   = 'assets/scene/Models/Bullet.glb'
const BULLET_SPEED = 40
const BULLET_LIFE  = 1.5

type RemoteBullet = { entity: Entity; vx: number; vy: number; vz: number; lifetime: number }
const remoteBullets: RemoteBullet[] = []

export function spawnRemoteBullet(
  pos: { x: number; y: number; z: number },
  rot: { x: number; y: number; z: number; w: number }
) {
  const fwd = Vector3.rotate(Vector3.Forward(), Quaternion.create(rot.x, rot.y, rot.z, rot.w))

  const entity = engine.addEntity()
  GltfContainer.create(entity, {
    src: BULLET_SRC,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    visibleMeshesCollisionMask:   ColliderLayer.CL_NONE,
  })
  Transform.create(entity, {
    position: pos,
    scale: { x: 0.05, y: 0.05, z: 0.05 },
  })
  remoteBullets.push({ entity, vx: fwd.x * BULLET_SPEED, vy: fwd.y * BULLET_SPEED, vz: fwd.z * BULLET_SPEED, lifetime: BULLET_LIFE })
}

engine.addSystem((dt: number) => {
  for (let i = remoteBullets.length - 1; i >= 0; i--) {
    const b = remoteBullets[i]
    b.lifetime -= dt
    if (b.lifetime <= 0) {
      engine.removeEntity(b.entity)
      remoteBullets.splice(i, 1)
      continue
    }
    const t = Transform.getMutable(b.entity)
    t.position = {
      x: t.position.x + b.vx * dt,
      y: t.position.y + b.vy * dt,
      z: t.position.z + b.vz * dt,
    }
  }
})
