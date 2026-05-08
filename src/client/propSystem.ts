import { engine, Entity, GltfContainer, ColliderLayer, Transform, PlayerIdentityData } from '@dcl/sdk/ecs'

// World-space prop entities for OTHER disguised players (not local)
const propsByAddress = new Map<string, Entity>()

function getPlayerWorldPosition(address: string): { x: number; y: number; z: number } | null {
  const normalized = address.toLowerCase()
  for (const [entity, identity, transform] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
    if (identity.address.toLowerCase() === normalized) {
      return { x: transform.position.x, y: transform.position.y, z: transform.position.z }
    }
  }
  return null
}

function getLocalAddress(): string {
  const identity = PlayerIdentityData.getOrNull(engine.PlayerEntity)
  return identity?.address?.toLowerCase() ?? ''
}

export function onPlayerDisguised(address: string, propSrc: string) {
  const normalized = address.toLowerCase()
  if (normalized === getLocalAddress()) return  // local player handles their own prop via ui.tsx

  // Remove any previous prop for this player
  onPlayerUndisguised(normalized)

  const entity = engine.addEntity()
  GltfContainer.create(entity, {
    src: propSrc,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
  })
  // Position will be updated each frame by the system below
  Transform.create(entity, { position: { x: 0, y: -1000, z: 0 } })
  propsByAddress.set(normalized, entity)
}

export function onPlayerUndisguised(address: string) {
  const entity = propsByAddress.get(address.toLowerCase())
  if (!entity) return
  engine.removeEntity(entity)
  propsByAddress.delete(address.toLowerCase())
}

// DCL's physics capsule keeps the player root slightly above the visual floor.
// Subtract this offset so world-space props sit on the ground.
const PHYSICS_FLOOR_OFFSET = 0.1

engine.addSystem(() => {
  for (const [address, entity] of propsByAddress) {
    const pos = getPlayerWorldPosition(address)
    if (!pos) continue
    Transform.getMutable(entity).position = { x: pos.x, y: pos.y - PHYSICS_FLOOR_OFFSET, z: pos.z }
  }
})
