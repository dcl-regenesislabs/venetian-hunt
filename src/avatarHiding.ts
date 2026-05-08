import { engine, AvatarModifierArea, AvatarModifierType, Transform, Entity } from '@dcl/sdk/ecs'

// Covers the full 80x80m scene with generous margin
const SCENE_CENTER = { x: 40, y: 25, z: 40 }
const AREA_SIZE    = { x: 200, y: 100, z: 200 }

let areaEntity: Entity | undefined

export function setupAvatarHiding(): void {
  areaEntity = engine.addEntity()
  Transform.create(areaEntity, { position: SCENE_CENTER })
  AvatarModifierArea.create(areaEntity, {
    area: AREA_SIZE,
    modifiers: [AvatarModifierType.AMT_HIDE_AVATARS, AvatarModifierType.AMT_DISABLE_PASSPORTS],
    excludeIds: []   // everyone hidden by default — server will add shooters here
  })
}

// Called by the server client whenever roles change
export function updateShooterIds(shooterAddresses: string[]): void {
  if (!areaEntity) return
  AvatarModifierArea.getMutable(areaEntity).excludeIds = shooterAddresses.map(a => a.toLowerCase())
}
