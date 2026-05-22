import { engine, Entity, Transform, PlayerIdentityData, VisibilityComponent } from '@dcl/sdk/ecs'
import { applyPropComponents, primitiveDisguiseTransform } from '../propUtils'
import { createHealthBar, removeHealthBar, clearAllHealthBars } from './hiderHealth'

// World-space prop entities for OTHER disguised players (not local)
const propsByAddress  = new Map<string, Entity>()
const propYOffset     = new Map<string, number>()  // extra y for primitive center offset
const propSrcByAddress = new Map<string, string>()
const pendingDisguises = new Map<string, string>()
let localAddressCache = ''

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
  if (localAddressCache) return localAddressCache
  const identity = PlayerIdentityData.getOrNull(engine.PlayerEntity)
  return identity?.address?.toLowerCase() ?? ''
}

export function setLocalPlayerAddress(address: string | undefined) {
  const next = address?.toLowerCase() ?? ''
  localAddressCache = next
  if (!localAddressCache || pendingDisguises.size === 0) return

  for (const [pendingAddress, propSrc] of [...pendingDisguises]) {
    if (pendingAddress !== localAddressCache) createRemoteProp(pendingAddress, propSrc)
    pendingDisguises.delete(pendingAddress)
  }
}

function createRemoteProp(address: string, propSrc: string) {
  const normalized = address.toLowerCase()

  // Remove any previous prop for this player
  onPlayerUndisguised(normalized)

  const entity = engine.addEntity()
  applyPropComponents(entity, propSrc, true)
  const prim = primitiveDisguiseTransform(propSrc)
  Transform.create(entity, {
    position: { x: 0, y: prim ? prim.y - 1000 : -1000, z: 0 },
    scale:    prim ? prim.scale : { x: 1, y: 1, z: 1 },
  })
  VisibilityComponent.createOrReplace(entity, { visible: true })
  propsByAddress.set(normalized, entity)
  propYOffset.set(normalized, prim ? prim.y : 0)
  propSrcByAddress.set(normalized, propSrc)
  createHealthBar(normalized, entity)
}

export function onPlayerDisguised(address: string, propSrc: string) {
  const normalized = address.toLowerCase()
  const localAddress = getLocalAddress()
  if (!localAddress) {
    pendingDisguises.set(normalized, propSrc)
    return
  }
  if (normalized === localAddress) return  // local player handles their own prop via ui.tsx
  createRemoteProp(normalized, propSrc)
}

export function syncRemoteDisguises(disguises: ReadonlyArray<{ address: string; propSrc: string }>) {
  const localAddress = getLocalAddress()
  if (!localAddress) {
    for (const disguise of disguises) {
      pendingDisguises.set(disguise.address.toLowerCase(), disguise.propSrc)
    }
    return
  }

  const desired = new Map<string, string>()
  for (const disguise of disguises) {
    const normalized = disguise.address.toLowerCase()
    if (normalized === localAddress) continue
    desired.set(normalized, disguise.propSrc)
  }

  for (const [address, propSrc] of desired) {
    if (!propsByAddress.has(address) || propSrcByAddress.get(address) !== propSrc) {
      createRemoteProp(address, propSrc)
    }
  }

  for (const address of [...propsByAddress.keys()]) {
    if (!desired.has(address)) onPlayerUndisguised(address)
  }
}

export function blinkPlayerProp(address: string) {
  const entity = propsByAddress.get(address.toLowerCase())
  if (entity) blinkEntity(entity)
}

export function clearAllProps() {
  for (const [, entity] of propsByAddress) {
    stopBlinkingEntity(entity)
    engine.removeEntity(entity)
  }
  propsByAddress.clear()
  propYOffset.clear()
  propSrcByAddress.clear()
  pendingDisguises.clear()
  clearAllHealthBars()
}

export function onPlayerUndisguised(address: string) {
  const entity = propsByAddress.get(address.toLowerCase())
  if (!entity) return
  stopBlinkingEntity(entity)
  engine.removeEntity(entity)
  propsByAddress.delete(address.toLowerCase())
  propYOffset.delete(address.toLowerCase())
  propSrcByAddress.delete(address.toLowerCase())
  removeHealthBar(address.toLowerCase())
}

// ── Blink system ──────────────────────────────────────────────────
type BlinkState = { entity: Entity; remaining: number; elapsed: number; visible: boolean }
const blinkQueue: BlinkState[] = []
const BLINK_INTERVAL = 0.1  // seconds between toggles
const BLINK_DURATION = 1.5  // total seconds

export function stopBlinkingEntity(entity: Entity) {
  for (let i = blinkQueue.length - 1; i >= 0; i--) {
    if (blinkQueue[i].entity === entity) {
      blinkQueue.splice(i, 1)
    }
  }
  VisibilityComponent.createOrReplace(entity, { visible: true })
}

export function blinkEntity(entity: Entity) {
  stopBlinkingEntity(entity)
  blinkQueue.push({ entity, remaining: BLINK_DURATION, elapsed: 0, visible: true })
}

engine.addSystem((dt: number) => {
  for (let i = blinkQueue.length - 1; i >= 0; i--) {
    const b = blinkQueue[i]
    b.remaining -= dt
    b.elapsed   += dt
    if (b.elapsed >= BLINK_INTERVAL) {
      b.elapsed = 0
      b.visible = !b.visible
      VisibilityComponent.createOrReplace(b.entity, { visible: b.visible })
    }
    if (b.remaining <= 0) {
      VisibilityComponent.createOrReplace(b.entity, { visible: true })
      blinkQueue.splice(i, 1)
    }
  }
})

// ── World-space props ─────────────────────────────────────────────
engine.addSystem(() => {
  for (const [address, entity] of propsByAddress) {
    const pos = getPlayerWorldPosition(address)
    if (!pos) continue
    const yOff = propYOffset.get(address) ?? 0
    Transform.getMutable(entity).position = { x: pos.x, y: pos.y + yOff, z: pos.z }
  }
})
