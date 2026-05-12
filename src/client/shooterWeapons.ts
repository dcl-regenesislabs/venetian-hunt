import { engine, GltfContainer, ColliderLayer, Transform, PlayerIdentityData, Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

const WEAPON_SRC        = 'assets/scene/Models/low-poly_agm-1.glb'
const ROOT_OFFSET       = Vector3.create(0, 0, 0)
const MODEL_OFFSET      = Vector3.create(0.2, 0.9, 0.1)
const MODEL_ROTATION    = Quaternion.fromEulerDegrees(0, 90, 0)
const MODEL_SCALE       = Vector3.create(0.02, 0.02, 0.02)

type WeaponEntry = {
  avatarEntity: Entity
  rootEntity:   Entity
  modelEntity:  Entity
}

const entriesByAddress  = new Map<string, WeaponEntry>()
const aimByAddress      = new Map<string, { x: number; y: number; z: number; w: number }>()

export function updateShooterAim(shooterAddress: string, rx: number, ry: number, rz: number, rw: number) {
  aimByAddress.set(shooterAddress.toLowerCase(), { x: rx, y: ry, z: rz, w: rw })
}

export function updateShooterWeapons(shooterAddresses: string[], localAddress: string) {
  const normalized = shooterAddresses.map(a => a.toLowerCase())

  // Remove weapons for players no longer shooters
  for (const [addr, entry] of entriesByAddress) {
    if (!normalized.includes(addr)) {
      engine.removeEntity(entry.modelEntity)
      engine.removeEntity(entry.rootEntity)
      entriesByAddress.delete(addr)
    }
  }

  // Sync roster from current entities in scene
  for (const [avatarEntity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const addr = identity.address?.toLowerCase()
    if (!addr || addr === localAddress) continue
    if (!normalized.includes(addr)) continue
    if (entriesByAddress.has(addr)) {
      // Update avatar entity reference in case it changed
      entriesByAddress.get(addr)!.avatarEntity = avatarEntity
      continue
    }

    // Create root + model child
    const rootEntity  = engine.addEntity()
    const modelEntity = engine.addEntity()

    Transform.create(rootEntity, {
      position: Vector3.Zero(),
      rotation: Quaternion.Identity(),
      scale:    Vector3.One(),
    })
    Transform.create(modelEntity, {
      parent:   rootEntity,
      position: MODEL_OFFSET,
      rotation: MODEL_ROTATION,
      scale:    MODEL_SCALE,
    })
    GltfContainer.create(modelEntity, {
      src: WEAPON_SRC,
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      visibleMeshesCollisionMask:   ColliderLayer.CL_NONE,
    })

    entriesByAddress.set(addr, { avatarEntity, rootEntity, modelEntity })
  }
}

// World-space muzzle tip of the remote weapon model.
// Derived from the transform hierarchy: root (aim rotation) → model child at MODEL_OFFSET + muzzle local (-0.6,0.1,0) rotated by MODEL_ROTATION(90°Y) = (0,0.1,0.6) → sum (0.2,1.0,0.7) in root space.
export function getShooterMuzzleWorld(shooterAddress: string): { x: number; y: number; z: number } | null {
  const entry = entriesByAddress.get(shooterAddress.toLowerCase())
  if (!entry) return null
  const root = Transform.getOrNull(entry.rootEntity)
  if (!root) return null
  const muzzleInRoot = Vector3.rotate(Vector3.create(0.2, 1.0, 0.7), root.rotation)
  return {
    x: root.position.x + muzzleInRoot.x,
    y: root.position.y + muzzleInRoot.y,
    z: root.position.z + muzzleInRoot.z,
  }
}

export function clearShooterWeapons() {
  for (const entry of entriesByAddress.values()) {
    engine.removeEntity(entry.modelEntity)
    engine.removeEntity(entry.rootEntity)
  }
  entriesByAddress.clear()
}

engine.addSystem(() => {
  for (const [addr, entry] of entriesByAddress) {
    const avatarTransform = Transform.getOrNull(entry.avatarEntity)
    if (!avatarTransform) continue

    const aim = aimByAddress.get(addr)
    const aimRot = aim ? Quaternion.create(aim.x, aim.y, aim.z, aim.w) : avatarTransform.rotation

    const root = Transform.getMutable(entry.rootEntity)
    // Position follows body (yaw only), rotation uses synced camera aim (yaw + pitch)
    root.position = Vector3.add(
      avatarTransform.position,
      Vector3.rotate(ROOT_OFFSET, avatarTransform.rotation)
    )
    root.rotation = aimRot
  }
})
