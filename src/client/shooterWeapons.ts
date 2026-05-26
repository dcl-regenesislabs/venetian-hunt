import { engine, Animator, GltfContainer, ColliderLayer, Transform, PlayerIdentityData, Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

const WEAPON_SRC = 'assets/scene/Models/low-poly_agm-1.glb'
const SHOOTER_BODY_SRC = 'assets/scene/Models/hunter_all_anims.glb'

const ROOT_OFFSET = Vector3.create(0, 0, 0)
const MODEL_SCALE = Vector3.create(0.02, 0.02, 0.02)

const BODY_OFFSET = Vector3.create(0, 0.05, 0)
const BODY_ROTATION = Quaternion.Identity()
const BODY_SCALE = Vector3.create(0.33, 0.33, 0.33)
const BODY_IDLE_CLIP = 'Idle'
const BODY_RUN_CLIP = 'Running'
const BODY_WAIT_CLIP = 'RifleAimingIdle'
const BODY_RUN_SHOOT_CLIP = 'RunAndShoot'
const BODY_AIM_UP_CLIP = 'AimUp'
const BODY_AIM_DOWN_CLIP = 'AimDown'
const BODY_RUN_AIM_UP_CLIP = 'RunAimUp'
const BODY_RUN_AIM_DOWN_CLIP = 'RunAimDown'
const BODY_RUN_SPEED = 0.75
const POSITION_SMOOTH_SPEED = 10
const BODY_ROTATION_SMOOTH = 12
const AIM_ROTATION_SMOOTH = 14
const ANIMATION_BLEND_SPEED = 8
const RUN_START_SPEED = 0.11
const RUN_STOP_SPEED = 0.05
const PITCH_SMOOTH_SPEED = 10
const MAX_AIM_PITCH_DEG = 55
const DEFAULT_WAITING_MODEL_OFFSET = Vector3.create(0.2, 1.4, 0.26)
const DEFAULT_WAITING_MODEL_ROTATION = Vector3.create(0, 70, 0)
const DEFAULT_ACTIVE_MODEL_OFFSET = Vector3.create(0.2, 1.4, 0.26)
const DEFAULT_ACTIVE_MODEL_ROTATION = Vector3.create(0, 70, 0)
let waitingModelOffset = Vector3.clone(DEFAULT_WAITING_MODEL_OFFSET)
let waitingModelRotation = Vector3.clone(DEFAULT_WAITING_MODEL_ROTATION)
let activeModelOffset = Vector3.clone(DEFAULT_ACTIVE_MODEL_OFFSET)
let activeModelRotation = Vector3.clone(DEFAULT_ACTIVE_MODEL_ROTATION)

type PresentationMode = 'waiting' | 'active'

type WeaponEntry = {
  avatarEntity: Entity
  bodyRootEntity: Entity
  bodyEntity: Entity
  rootEntity: Entity
  pitchRootEntity: Entity
  modelEntity: Entity
  lastPosition: { x: number; y: number; z: number }
  smoothedPosition: { x: number; y: number; z: number }
  smoothedBodyRotation: { x: number; y: number; z: number; w: number }
  smoothedAimRotation: { x: number; y: number; z: number; w: number }
  smoothedPitchDeg: number
  running: boolean
  runWeight: number
  idleAimWeight: number
  idleUpWeight: number
  idleDownWeight: number
  runShootWeight: number
  runUpWeight: number
  runDownWeight: number
}

type PreviewEntry = {
  bodyRootEntity: Entity
  bodyEntity: Entity
  rootEntity: Entity
  pitchRootEntity: Entity
  modelEntity: Entity
}

const entriesByAddress = new Map<string, WeaponEntry>()
const aimByAddress = new Map<string, { x: number; y: number; z: number; w: number }>()
let includeLocalShooter = false
let presentationMode: PresentationMode = 'active'
let currentLocalAddress = ''
let calibrationMirrorEnabled = false
let calibrationMirrorPreview: PreviewEntry | undefined

export type ShooterAnimationDebug = {
  pitchDeg: number
  runWeight: number
  idleAimWeight: number
  idleUpWeight: number
  idleDownWeight: number
  runShootWeight: number
  runUpWeight: number
  runDownWeight: number
}

export function updateShooterAim(shooterAddress: string, rx: number, ry: number, rz: number, rw: number) {
  aimByAddress.set(shooterAddress.toLowerCase(), { x: rx, y: ry, z: rz, w: rw })
}

export function setCalibrationMirrorActive(active: boolean) {
  calibrationMirrorEnabled = active
  if (!active) {
    destroyPreviewEntry(calibrationMirrorPreview)
    calibrationMirrorPreview = undefined
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function getForwardFromQuaternion(rotation: { x: number; y: number; z: number; w: number }) {
  return {
    x: 2 * (rotation.x * rotation.z + rotation.w * rotation.y),
    y: 2 * (rotation.y * rotation.z - rotation.w * rotation.x),
    z: 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y),
  }
}

function getAimPitchDegrees(rotation: { x: number; y: number; z: number; w: number }) {
  const forward = getForwardFromQuaternion(rotation)
  const planar = Math.sqrt(forward.x * forward.x + forward.z * forward.z)
  return Math.atan2(forward.y, Math.max(0.0001, planar)) * 180 / Math.PI
}

function getAimYawDegrees(rotation: { x: number; y: number; z: number; w: number }) {
  const forward = getForwardFromQuaternion(rotation)
  return Math.atan2(forward.x, forward.z) * 180 / Math.PI
}

function createPreviewEntry(): PreviewEntry {
  const bodyRootEntity = engine.addEntity()
  const bodyEntity = engine.addEntity()
  const rootEntity = engine.addEntity()
  const pitchRootEntity = engine.addEntity()
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
      { clip: BODY_RUN_SHOOT_CLIP, playing: true, loop: true, speed: BODY_RUN_SPEED, weight: 0 },
      { clip: BODY_AIM_UP_CLIP, playing: true, loop: true, weight: 0 },
      { clip: BODY_AIM_DOWN_CLIP, playing: true, loop: true, weight: 0 },
      { clip: BODY_RUN_AIM_UP_CLIP, playing: true, loop: true, speed: BODY_RUN_SPEED, weight: 0 },
      { clip: BODY_RUN_AIM_DOWN_CLIP, playing: true, loop: true, speed: BODY_RUN_SPEED, weight: 0 },
    ],
  })

  Transform.create(rootEntity, {
    position: Vector3.Zero(),
    rotation: Quaternion.Identity(),
    scale: Vector3.One(),
  })
  Transform.create(pitchRootEntity, {
    parent: rootEntity,
    position: Vector3.Zero(),
    rotation: Quaternion.Identity(),
    scale: Vector3.One(),
  })
  Transform.create(modelEntity, {
    parent: pitchRootEntity,
    position: Vector3.Zero(),
    rotation: Quaternion.fromEulerDegrees(activeModelRotation.x, activeModelRotation.y, activeModelRotation.z),
    scale: MODEL_SCALE,
  })
  GltfContainer.create(modelEntity, {
    src: WEAPON_SRC,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
  })

  return { bodyRootEntity, bodyEntity, rootEntity, pitchRootEntity, modelEntity }
}

function destroyPreviewEntry(entry: PreviewEntry | undefined) {
  if (!entry) return
  engine.removeEntity(entry.bodyEntity)
  engine.removeEntity(entry.bodyRootEntity)
  engine.removeEntity(entry.modelEntity)
  engine.removeEntity(entry.pitchRootEntity)
  engine.removeEntity(entry.rootEntity)
}

export function updateShooterWeapons(
  shooterAddresses: string[],
  localAddress: string,
  options?: { includeLocal?: boolean; mode?: PresentationMode }
) {
  const normalized = shooterAddresses.map((address) => address.toLowerCase())
  currentLocalAddress = localAddress.toLowerCase()
  includeLocalShooter = !!options?.includeLocal
  presentationMode = options?.mode ?? 'active'

  for (const [addr, entry] of entriesByAddress) {
    if (!normalized.includes(addr) || (!includeLocalShooter && addr === localAddress)) {
      engine.removeEntity(entry.bodyEntity)
      engine.removeEntity(entry.bodyRootEntity)
      engine.removeEntity(entry.modelEntity)
      engine.removeEntity(entry.pitchRootEntity)
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
    const pitchRootEntity = engine.addEntity()
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
        { clip: BODY_RUN_SHOOT_CLIP, playing: true, loop: true, speed: BODY_RUN_SPEED, weight: 0 },
        { clip: BODY_AIM_UP_CLIP, playing: true, loop: true, weight: 0 },
        { clip: BODY_AIM_DOWN_CLIP, playing: true, loop: true, weight: 0 },
        { clip: BODY_RUN_AIM_UP_CLIP, playing: true, loop: true, speed: BODY_RUN_SPEED, weight: 0 },
        { clip: BODY_RUN_AIM_DOWN_CLIP, playing: true, loop: true, speed: BODY_RUN_SPEED, weight: 0 },
      ],
    })

    Transform.create(rootEntity, {
      position: Vector3.Zero(),
      rotation: Quaternion.Identity(),
      scale: Vector3.One(),
    })
    Transform.create(pitchRootEntity, {
      parent: rootEntity,
      position: Vector3.Zero(),
      rotation: Quaternion.Identity(),
      scale: Vector3.One(),
    })
    Transform.create(modelEntity, {
      parent: pitchRootEntity,
      position: Vector3.Zero(),
      rotation: Quaternion.fromEulerDegrees(activeModelRotation.x, activeModelRotation.y, activeModelRotation.z),
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
      pitchRootEntity,
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
      smoothedPitchDeg: 0,
      running: false,
      runWeight: 0,
      idleAimWeight: 1,
      idleUpWeight: 0,
      idleDownWeight: 0,
      runShootWeight: 0,
      runUpWeight: 0,
      runDownWeight: 0,
    })
  }
}

export function getShooterMuzzleWorld(shooterAddress: string): { x: number; y: number; z: number } | null {
  const entry = entriesByAddress.get(shooterAddress.toLowerCase())
  if (!entry) return null
  const root = Transform.getOrNull(entry.rootEntity)
  const pitchRoot = Transform.getOrNull(entry.pitchRootEntity)
  const model = Transform.getOrNull(entry.modelEntity)
  if (!root || !pitchRoot || !model) return null
  let muzzleInRoot = Vector3.rotate(Vector3.create(0.2, 1.0, 0.7), model.rotation)
  muzzleInRoot = Vector3.add(model.position, muzzleInRoot)
  muzzleInRoot = Vector3.rotate(muzzleInRoot, pitchRoot.rotation)
  muzzleInRoot = Vector3.add(pitchRoot.position, muzzleInRoot)
  muzzleInRoot = Vector3.rotate(muzzleInRoot, root.rotation)
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
    engine.removeEntity(entry.pitchRootEntity)
    engine.removeEntity(entry.rootEntity)
  }
  entriesByAddress.clear()
  destroyPreviewEntry(calibrationMirrorPreview)
  calibrationMirrorPreview = undefined
}

export function setShooterWeaponsVisible(visible: boolean) {
  if (visible) return
  for (const entry of entriesByAddress.values()) {
    engine.removeEntity(entry.bodyEntity)
    engine.removeEntity(entry.bodyRootEntity)
    engine.removeEntity(entry.modelEntity)
    engine.removeEntity(entry.pitchRootEntity)
    engine.removeEntity(entry.rootEntity)
  }
  entriesByAddress.clear()
  destroyPreviewEntry(calibrationMirrorPreview)
  calibrationMirrorPreview = undefined
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

export function getActiveWeaponOffset(): { x: number; y: number; z: number } {
  return Vector3.clone(activeModelOffset)
}

export function nudgeActiveWeaponOffset(axis: 'x' | 'y' | 'z', delta: number) {
  activeModelOffset[axis] += delta
}

export function resetActiveWeaponOffset() {
  activeModelOffset = Vector3.clone(DEFAULT_ACTIVE_MODEL_OFFSET)
}

export function getActiveWeaponRotation(): { x: number; y: number; z: number } {
  return Vector3.clone(activeModelRotation)
}

export function nudgeActiveWeaponRotation(axis: 'x' | 'y' | 'z', delta: number) {
  activeModelRotation[axis] += delta
}

export function resetActiveWeaponRotation() {
  activeModelRotation = Vector3.clone(DEFAULT_ACTIVE_MODEL_ROTATION)
}

export function getShooterAnimationDebug(address?: string): ShooterAnimationDebug | null {
  const entry = address ? entriesByAddress.get(address.toLowerCase()) : entriesByAddress.values().next().value as WeaponEntry | undefined
  if (!entry) return null
  return {
    pitchDeg: entry.smoothedPitchDeg,
    runWeight: entry.runWeight,
    idleAimWeight: entry.idleAimWeight,
    idleUpWeight: entry.idleUpWeight,
    idleDownWeight: entry.idleDownWeight,
    runShootWeight: entry.runShootWeight,
    runUpWeight: entry.runUpWeight,
    runDownWeight: entry.runDownWeight,
  }
}

engine.addSystem((dt) => {
  for (const [addr, entry] of entriesByAddress) {
    const avatarTransform = Transform.getOrNull(entry.avatarEntity)
    if (!avatarTransform) continue

    const aim = aimByAddress.get(addr)
    let aimRot = aim ? Quaternion.create(aim.x, aim.y, aim.z, aim.w) : avatarTransform.rotation
    if (addr === currentLocalAddress) {
      const cameraTransform = Transform.getOrNull(engine.CameraEntity)
      if (cameraTransform) {
        aimRot = cameraTransform.rotation
      }
    }
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
    const pitchAlpha = Math.min(1, dt * PITCH_SMOOTH_SPEED)
    entry.smoothedPosition = Vector3.lerp(entry.smoothedPosition, avatarTransform.position, positionAlpha)
    entry.smoothedAimRotation = Quaternion.slerp(entry.smoothedAimRotation, aimRot, aimAlpha)
    const aimYaw = getAimYawDegrees(aimRot)
    const bodyYawRotation = Quaternion.fromEulerDegrees(0, aimYaw, 0)
    entry.smoothedBodyRotation = Quaternion.slerp(entry.smoothedBodyRotation, bodyYawRotation, rotationAlpha)
    const targetPitchDeg = getAimPitchDegrees(aimRot)
    entry.smoothedPitchDeg = entry.smoothedPitchDeg + (targetPitchDeg - entry.smoothedPitchDeg) * pitchAlpha
    const targetRunWeight = entry.running ? 1 : 0
    const blendAlpha = Math.min(1, dt * ANIMATION_BLEND_SPEED)
    entry.runWeight = entry.runWeight + (targetRunWeight - entry.runWeight) * blendAlpha

    const bodyRoot = Transform.getMutable(entry.bodyRootEntity)
    bodyRoot.position = Vector3.add(entry.smoothedPosition, Vector3.rotate(ROOT_OFFSET, entry.smoothedBodyRotation))
    bodyRoot.rotation = entry.smoothedBodyRotation

    const animator = Animator.getMutable(entry.bodyEntity)
    const idleState = animator.states.find((state) => state.clip === BODY_IDLE_CLIP)
    const runState = animator.states.find((state) => state.clip === BODY_RUN_CLIP)
    const waitState = animator.states.find((state) => state.clip === BODY_WAIT_CLIP)
    const runShootState = animator.states.find((state) => state.clip === BODY_RUN_SHOOT_CLIP)
    const aimUpState = animator.states.find((state) => state.clip === BODY_AIM_UP_CLIP)
    const aimDownState = animator.states.find((state) => state.clip === BODY_AIM_DOWN_CLIP)
    const runAimUpState = animator.states.find((state) => state.clip === BODY_RUN_AIM_UP_CLIP)
    const runAimDownState = animator.states.find((state) => state.clip === BODY_RUN_AIM_DOWN_CLIP)
    if (presentationMode === 'waiting') {
      entry.runWeight = 0
      entry.idleAimWeight = 0
      entry.idleUpWeight = 0
      entry.idleDownWeight = 0
      entry.runShootWeight = 0
      entry.runUpWeight = 0
      entry.runDownWeight = 0
      if (idleState) idleState.weight = 0
      if (runState) runState.weight = 0
      if (waitState) {
        waitState.playing = true
        waitState.weight = 1
      }
      if (runShootState) runShootState.weight = 0
      if (aimUpState) aimUpState.weight = 0
      if (aimDownState) aimDownState.weight = 0
      if (runAimUpState) runAimUpState.weight = 0
      if (runAimDownState) runAimDownState.weight = 0
    } else {
      const normalizedPitch = clamp01(Math.abs(entry.smoothedPitchDeg) / MAX_AIM_PITCH_DEG)
      const upBlend = entry.smoothedPitchDeg > 0 ? normalizedPitch : 0
      const downBlend = entry.smoothedPitchDeg < 0 ? normalizedPitch : 0
      const idleFamilyWeight = 1 - entry.runWeight
      const runFamilyWeight = entry.runWeight

      entry.idleAimWeight = idleFamilyWeight * (1 - normalizedPitch)
      entry.idleUpWeight = idleFamilyWeight * upBlend
      entry.idleDownWeight = idleFamilyWeight * downBlend
      entry.runShootWeight = runFamilyWeight * (1 - normalizedPitch)
      entry.runUpWeight = runFamilyWeight * upBlend
      entry.runDownWeight = runFamilyWeight * downBlend

      if (idleState) idleState.weight = 0
      if (runState) runState.weight = 0
      if (waitState) {
        waitState.playing = true
        waitState.weight = entry.idleAimWeight
      }
      if (runShootState) {
        runShootState.playing = true
        runShootState.weight = entry.runShootWeight
      }
      if (aimUpState) {
        aimUpState.playing = true
        aimUpState.weight = entry.idleUpWeight
      }
      if (aimDownState) {
        aimDownState.playing = true
        aimDownState.weight = entry.idleDownWeight
      }
      if (runAimUpState) {
        runAimUpState.playing = true
        runAimUpState.weight = entry.runUpWeight
      }
      if (runAimDownState) {
        runAimDownState.playing = true
        runAimDownState.weight = entry.runDownWeight
      }
    }

    const root = Transform.getMutable(entry.rootEntity)
    const pitchRoot = Transform.getMutable(entry.pitchRootEntity)
    const model = Transform.getMutable(entry.modelEntity)
    const weaponRootOffset = presentationMode === 'waiting' ? waitingModelOffset : activeModelOffset
    root.position = Vector3.add(entry.smoothedPosition, Vector3.rotate(weaponRootOffset, entry.smoothedBodyRotation))
    root.rotation = entry.smoothedBodyRotation
    pitchRoot.rotation = Quaternion.fromEulerDegrees(-entry.smoothedPitchDeg, 0, 0)
    model.position = Vector3.Zero()
    model.rotation =
      presentationMode === 'waiting'
        ? Quaternion.fromEulerDegrees(waitingModelRotation.x, waitingModelRotation.y, waitingModelRotation.z)
        : Quaternion.fromEulerDegrees(activeModelRotation.x, activeModelRotation.y, activeModelRotation.z)
  }

  if (!calibrationMirrorEnabled || !currentLocalAddress) return

  const localEntry = entriesByAddress.get(currentLocalAddress)
  const cameraTransform = Transform.getOrNull(engine.CameraEntity)
  if (!localEntry || !cameraTransform) {
    destroyPreviewEntry(calibrationMirrorPreview)
    calibrationMirrorPreview = undefined
    return
  }

  if (!calibrationMirrorPreview) {
    calibrationMirrorPreview = createPreviewEntry()
  }

  const preview = calibrationMirrorPreview
  const cameraForward = getForwardFromQuaternion(cameraTransform.rotation)
  const forwardXZ = Vector3.normalize(Vector3.create(cameraForward.x, 0, cameraForward.z))
  const previewPos = Vector3.add(localEntry.smoothedPosition, Vector3.scale(forwardXZ, 2.5))
  const previewYaw = getAimYawDegrees(localEntry.smoothedAimRotation) + 180
  const previewBodyRot = Quaternion.fromEulerDegrees(0, previewYaw, 0)

  const previewBodyRoot = Transform.getMutable(preview.bodyRootEntity)
  previewBodyRoot.position = previewPos
  previewBodyRoot.rotation = previewBodyRot

  const previewRoot = Transform.getMutable(preview.rootEntity)
  previewRoot.position = Vector3.add(previewPos, Vector3.rotate(activeModelOffset, previewBodyRot))
  previewRoot.rotation = previewBodyRot

  const previewPitchRoot = Transform.getMutable(preview.pitchRootEntity)
  previewPitchRoot.rotation = Quaternion.fromEulerDegrees(-localEntry.smoothedPitchDeg, 0, 0)

  const previewModel = Transform.getMutable(preview.modelEntity)
  previewModel.position = Vector3.Zero()
  previewModel.rotation = Quaternion.fromEulerDegrees(activeModelRotation.x, activeModelRotation.y, activeModelRotation.z)

  const sourceAnimator = Animator.getMutable(localEntry.bodyEntity)
  const previewAnimator = Animator.getMutable(preview.bodyEntity)
  for (const previewState of previewAnimator.states) {
    const sourceState = sourceAnimator.states.find((state) => state.clip === previewState.clip)
    if (!sourceState) continue
    previewState.playing = sourceState.playing
    previewState.weight = sourceState.weight
    previewState.speed = sourceState.speed
    previewState.loop = sourceState.loop
  }
})
