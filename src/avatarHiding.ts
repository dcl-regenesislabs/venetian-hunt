import { engine, AvatarModifierArea, AvatarModifierType, Transform, Entity } from '@dcl/sdk/ecs'

const ACTIVE_POSITION = { x: 40, y: 25, z: 40 }
const INACTIVE_POSITION = { x: 4000, y: -1000, z: 4000 }
const AREA_SIZE = { x: 200, y: 100, z: 200 }

let hideArea: Entity | undefined
let active = false

export function setupAvatarHiding(): void {
  hideArea = engine.addEntity()
  Transform.create(hideArea, { position: INACTIVE_POSITION })
  AvatarModifierArea.create(hideArea, {
    area: AREA_SIZE,
    modifiers: [],
    excludeIds: [],
  })
}

export function activateAvatarHiding(): void {
  if (!hideArea || active) return
  active = true
  Transform.getMutable(hideArea).position = ACTIVE_POSITION
  AvatarModifierArea.createOrReplace(hideArea, {
    area: AREA_SIZE,
    modifiers: [AvatarModifierType.AMT_HIDE_AVATARS, AvatarModifierType.AMT_DISABLE_PASSPORTS],
    excludeIds: [],
  })
}

export function deactivateAvatarHiding(): void {
  if (!hideArea || !active) return
  active = false
  Transform.getMutable(hideArea).position = INACTIVE_POSITION
  AvatarModifierArea.createOrReplace(hideArea, {
    area: AREA_SIZE,
    modifiers: [],
    excludeIds: [],
  })
}
