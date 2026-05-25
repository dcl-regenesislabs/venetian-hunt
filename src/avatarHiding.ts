import { engine, AvatarModifierArea, AvatarModifierType, Transform, Entity } from '@dcl/sdk/ecs'

const SCENE_CENTER = { x: 40, y: 25, z: 40 }
const AREA_SIZE = { x: 200, y: 100, z: 200 }

let hideArea: Entity | undefined
let active = false

export function setupAvatarHiding(): void {
  hideArea = engine.addEntity()
  Transform.create(hideArea, { position: SCENE_CENTER })
}

export function activateAvatarHiding(): void {
  if (!hideArea || active) return
  active = true
  AvatarModifierArea.createOrReplace(hideArea, {
    area: AREA_SIZE,
    modifiers: [AvatarModifierType.AMT_HIDE_AVATARS, AvatarModifierType.AMT_DISABLE_PASSPORTS],
    excludeIds: [],
  })
}

export function deactivateAvatarHiding(): void {
  if (!hideArea || !active) return
  active = false
  AvatarModifierArea.deleteFrom(hideArea)
}
