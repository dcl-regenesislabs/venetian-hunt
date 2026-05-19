import { engine, AvatarModifierArea, AvatarModifierType, Transform, Entity } from '@dcl/sdk/ecs'

const SCENE_CENTER = { x: 40, y: 25, z: 40 }
const AREA_SIZE    = { x: 200, y: 100, z: 200 }

let hideArea: Entity | undefined
const shooterIds     = new Set<string>()
const undisguisedIds = new Set<string>()
let lastExcludeIds:  string[] = []

function applyExcludeIds() {
  if (!hideArea) return
  const next = [...shooterIds, ...undisguisedIds].sort()
  if (next.length === lastExcludeIds.length && next.every((id, i) => id === lastExcludeIds[i])) return
  lastExcludeIds = next
  AvatarModifierArea.createOrReplace(hideArea, {
    area:       AREA_SIZE,
    modifiers:  [AvatarModifierType.AMT_HIDE_AVATARS, AvatarModifierType.AMT_DISABLE_PASSPORTS],
    excludeIds: next,
  })
}

export function setupAvatarHiding(): void {
  hideArea = engine.addEntity()
  Transform.create(hideArea, { position: SCENE_CENTER })
  AvatarModifierArea.create(hideArea, {
    area: AREA_SIZE,
    modifiers: [AvatarModifierType.AMT_HIDE_AVATARS, AvatarModifierType.AMT_DISABLE_PASSPORTS],
    excludeIds: []
  })
}

export function updateShooterIds(addresses: string[]): void {
  shooterIds.clear()
  for (const a of addresses) shooterIds.add(a.toLowerCase())
  applyExcludeIds()
}

export function addVisiblePlayer(address: string): void {
  undisguisedIds.add(address.toLowerCase())
  applyExcludeIds()
}

export function removeVisiblePlayer(address: string): void {
  undisguisedIds.delete(address.toLowerCase())
  applyExcludeIds()
}

export function resetVisibility(): void {
  shooterIds.clear()
  undisguisedIds.clear()
  applyExcludeIds()
}
