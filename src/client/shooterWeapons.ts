import { engine, Animator, GltfContainer, ColliderLayer, Transform, PlayerIdentityData, Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

const WEAPON_SRC = 'assets/scene/Models/low-poly_agm-1.glb'
const SHOOTER_BODY_SRC = 'assets/scene/Models/venetian_hunter.glb'

const ROOT_OFFSET = Vector3.create(0, 0, 0)
const MODEL_OFFSET = Vector3.create(0.2, 0.9, 0.1)
const MODEL_ROTATION = Quaternion.fromEulerDegrees(0, 90, 0)
const MODEL_SCALE = Vector3.create(0.02, 0.02, 0.02)

const BODY_OFFSET = Vector3.create(0, 0.05, 0)
const BODY_ROTATION = Quaternion.Identity()
const BODY_SCALE = Vector3.create(0.33, 0.33, 0.33)
const BODY_IDLE_CLIP = 'Idle'
const BODY_RUN_CLIP = 'Running'
const BODY_WAIT_CLIP = 'RifleAimingIdle'
const BODY_RUN_SPEED = 0.75
const POSITION_SMOOTH_SPEED = 10
const BODY_ROTATION_SMOOTH = 12
const AIM_ROTATION_SMOOTH = 14
const ANIMATION_BLEND_SPEED = 8
const RUN_START_SPEED = 0.11
const RUN_STOP_SPEED = 0.05
const DEFAULT_WAITING_MODEL_OFFSET = Vector3.create(0.2, 1.4, 0.26)
const DEFAULT_WAITING_MODEL_ROTATION = Vector3.create(0, 70, 0)
const ACTIVE_MODEL_OFFSET = MODEL_OFFSET
let waitingModelOffset = Vector3.clone(DEFAULT_WAITING_MODEL_OFFSET)
let waitingModelRotation = Vector3.clone(DEFAULT_WAITING_MODEL_ROTATION)

type PresentationMode = 'waiting' | 'active'

type WeaponEntry = {
  avatarEntity: Entity
  bodyRootEntity: Entity
  bodyEntity: Entity
  rootEntity: Entity
  modelEntity: Entity
  lastPosition: { x: number; y: number; z: number }
  smoothedPosition: { x: number; y: number; z: number }
  smoothedBodyRotation: { x: number; y: number; z: number; w: number }
  smoothedAimRotation: { x: number; y: number; z: number; w: number }
  running: boolean
  runWeight: number
}

const entriesByAddress = new Map<string, WeaponEntry>()
const aimByAddress = new Map<string, { x: number; y: number; z: number; w: number }>()
let includeLocalShooter = false
let presentationMode: PresentationMode = 'active'

export function updateShooterAim(shooterAddress: string, rx: number, ry: number, rz: number, rw: number) {
  aimByAddress.set(shooterAddress.toLowerCase(), { x: rx, y: ry, z: rz, w: rw })
}

export function updateShooterWeapons(
  shooterAddresses: string[],
  localAddress: string,
  options?: { includeLocal?: boolean; mode?: PresentationMode }
) {
  const normalized = shooterAddresses.map((address) => address.toLowerCase())
  includeLocalShooter = !!options?.includeLocal
  presentationMode = options?.mode ?? 'active'

  for (const [addr, entry] of entriesByAddress) {
    if (!normalized.includes(addr) || (!includeLocalShooter && addr === localAddress)) {
      engine.removeEntity(entry.bodyEntity)
      engine.removeEntity(entry.bodyRootEntity)
      engine.removeEntity(entry.modelEntity)
      engine.removeEntity(entry.rootEntity)
      entriesByAddress.delete(addr)
    }
  }

  for (const [avatarEntity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const addr = identity.address?.toLowerCase()
    if (!addr) continue
    if (addr === localAddress && !includeLocalShooter) continue
    if (!normalized.includes(addr)) continue

    const avatarTransform = Transform.getOrNull(avatarEntity)
    if (!avatarTransform) continue

    const existing = entriesByAddress.get(addr)
    if (existing) {
      existing.avatarEntity = avatarEntity
      continue
    }

    const bodyRootEntity = engine.addEntity()
    const bodyEntity = engine.addEntity()
    const rootEntity = engine.addEntity()
    const modelEntity = engine.addEntity()

    Transform.create(bodyRootEntity, {
      position: Vector3.Zero(),
      rotation: Quaternion.Identity(),
      scale: Vector3.One(),
    })
    Transform.create(bodyEntity, {
      parent: bodyRootEntity,
      position: BODY_OFFSET,
      rotation: BODY_ROTATION,
      scale: BODY_SCALE,
    })
    GltfContainer.create(bodyEntity, {
      src: SHOOTER_BODY_SRC,
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    })
    Animator.create(bodyEntity, {
      states: [
        { clip: BODY_IDLE_CLIP, playing: true, loop: true, weight: 1 },
        { clip: BODY_RUN_CLIP, playing: true, loop: true, speed: BODY_RUN_SPEED, weight: 0 },
        { clip: BODY_WAIT_CLIP, playing: true, loop: true, weight: 0 },
      ],
    })

    Transform.create(rootEntity, {
      position: Vector3.Zero(),
      rotation: Quaternion.Identity(),
      scale: Vector3.One(),
    })
    Transform.create(modelEntity, {
      parent: rootEntity,
      position: ACTIVE_MODEL_OFFSET,
      rotation: MODEL_ROTATION,
      scale: MODEL_SCALE,
    })
    GltfContainer.create(modelEntity, {
      src: WEAPON_SRC,
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    })

    entriesByAddress.set(addr, {
      avatarEntity,
      bodyRootEntity,
      bodyEntity,
      rootEntity,
      modelEntity,
      lastPosition: Vector3.clone(avatarTransform.position),
      smoothedPosition: Vector3.clone(avatarTransform.position),
      smoothedBodyRotation: Quaternion.create(
        avatarTransform.rotation.x,
        avatarTransform.rotation.y,
        avatarTransform.rotation.z,
        avatarTransform.rotation.w
      ),
      smoothedAimRotation: Quaternion.create(
        avatarTransform.rotation.x,
        avatarTransform.rotation.y,
        avatarTransform.rotation.z,
        avatarTransform.rotation.w
      ),
      running: false,
      runWeight: 0,
    })
  }
}

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
    engine.removeEntity(entry.bodyEntity)
    engine.removeEntity(entry.bodyRootEntity)
    engine.removeEntity(entry.modelEntity)
    engine.removeEntity(entry.rootEntity)
  }
  entriesByAddress.clear()
}

export function setShooterWeaponsVisible(visible: boolean) {
  if (visible) return
  for (const entry of entriesByAddress.values()) {
    engine.removeEntity(entry.bodyEntity)
    engine.removeEntity(entry.bodyRootEntity)
    engine.removeEntity(entry.modelEntity)
    engine.removeEntity(entry.rootEntity)
  }
  entriesByAddress.clear()
}

export function getWaitingWeaponOffset(): { x: number; y: number; z: number } {
  return Vector3.clone(waitingModelOffset)
}

export function nudgeWaitingWeaponOffset(axis: 'x' | 'y' | 'z', delta: number) {
  waitingModelOffset[axis] += delta
}

export function resetWaitingWeaponOffset() {
  waitingModelOffset = Vector3.clone(DEFAULT_WAITING_MODEL_OFFSET)
}

export function getWaitingWeaponRotation(): { x: number; y: number; z: number } {
  return Vector3.clone(waitingModelRotation)
}

export function nudgeWaitingWeaponRotation(axis: 'x' | 'y' | 'z', delta: number) {
  waitingModelRotation[axis] += delta
}

export function resetWaitingWeaponRotation() {
  waitingModelRotation = Vector3.clone(DEFAULT_WAITING_MODEL_ROTATION)
}

engine.addSystem((dt) => {
  for (const [addr, entry] of entriesByAddress) {
    const avatarTransform = Transform.getOrNull(entry.avatarEntity)
    if (!avatarTransform) continue

    const aim = aimByAddress.get(addr)
    const aimRot = aim ? Quaternion.create(aim.x, aim.y, aim.z, aim.w) : avatarTransform.rotation
    const dx = avatarTransform.position.x - entry.lastPosition.x
    const dz = avatarTransform.position.z - entry.lastPosition.z
    const planarDistance = Math.sqrt(dx * dx + dz * dz)
    const planarSpeed = dt > 0 ? planarDistance / dt : 0
    entry.lastPosition = Vector3.clone(avatarTransform.position)

    if (entry.running) {
      entry.running = planarSpeed > RUN_STOP_SPEED
    } else {
      entry.running = planarSpeed > RUN_START_SPEED
    }

    const positionAlpha = Math.min(1, dt * POSITION_SMOOTH_SPEED)
    const rotationAlpha = Math.min(1, dt * BODY_ROTATION_SMOOTH)
    const aimAlpha = Math.min(1, dt * AIM_ROTATION_SMOOTH)
    entry.smoothedPosition = Vector3.lerp(entry.smoothedPosition, avatarTransform.position, positionAlpha)
    entry.smoothedBodyRotation = Quaternion.slerp(entry.smoothedBodyRotation, avatarTransform.rotation, rotationAlpha)
    entry.smoothedAimRotation = Quaternion.slerp(entry.smoothedAimRotation, aimRot, aimAlpha)
    const targetRunWeight = entry.running ? 1 : 0
    const blendAlpha = Math.min(1, dt * ANIMATION_BLEND_SPEED)
    entry.runWeight = entry.runWeight + (targetRunWeight - entry.runWeight) * blendAlpha

    const bodyRoot = Transform.getMutable(entry.bodyRootEntity)
    bodyRoot.position = Vector3.add(
      entry.smoothedPosition,
      Vector3.rotate(ROOT_OFFSET, entry.smoothedBodyRotation)
    )
    bodyRoot.rotation = entry.smoothedBodyRotation

    const animator = Animator.getMutable(entry.bodyEntity)
    const idleState = animator.states.find((state) => state.clip === BODY_IDLE_CLIP)
    const runState = animator.states.find((state) => state.clip === BODY_RUN_CLIP)
    const waitState = animator.states.find((state) => state.clip === BODY_WAIT_CLIP)
    if (presentationMode === 'waiting') {
      entry.runWeight = 0
      if (idleState) idleState.weight = 0
      if (runState) runState.weight = 0
      if (waitState) {
        waitState.playing = true
        waitState.weight = 1
      }
    } else {
      if (idleState) {
        idleState.playing = true
        idleState.weight = 1 - entry.runWeight
      }
      if (runState) {
        runState.playing = true
        runState.weight = entry.runWeight
      }
      if (waitState) {
        waitState.playing = true
        waitState.weight = 0
      }
    }

    const root = Transform.getMutable(entry.rootEntity)
    const model = Transform.getMutable(entry.modelEntity)
    root.position = Vector3.add(
      entry.smoothedPosition,
      Vector3.rotate(ROOT_OFFSET, entry.smoothedBodyRotation)
    )
    root.rotation = entry.smoothedAimRotation
    model.position = presentationMode === 'waiting' ? waitingModelOffset : ACTIVE_MODEL_OFFSET
    model.rotation =
      presentationMode === 'waiting'
        ? Quaternion.fromEulerDegrees(waitingModelRotation.x, waitingModelRotation.y, waitingModelRotation.z)
        : MODEL_ROTATION
  }
})
