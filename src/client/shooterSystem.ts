import {
  engine, Transform, PlayerIdentityData,
  GltfContainer, ColliderLayer, Entity,
  inputSystem, InputAction, PointerEventType
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { room } from '../shared/messages'
import { playGunshotAt } from './audioManager'

const BULLET_SRC   = 'assets/scene/Models/Bullet.glb'
const VFX_SRC      = 'assets/scene/Models/GunVFX.glb'
const BULLET_SPEED  = 40    // units/sec
const BULLET_LIFE   = 1.5   // seconds
const VFX_LIFE      = 0.2   // seconds
const HIT_RADIUS    = 1.2   // units
const FIRE_COOLDOWN = 0.3   // seconds between shots

type BulletData = { entity: Entity; vx: number; vy: number; vz: number; lifetime: number }
type VfxData    = { entity: Entity; lifetime: number }

let shooterActive  = false
let shooterPaused  = false
let weaponEntity: Entity | undefined
let fireCooldown   = 0
let aimFrameTimer  = 0
const AIM_INTERVAL = 0.07  // ~15 updates/sec
const bullets: BulletData[] = []
const vfxList:  VfxData[]   = []

// crosshair bloom: ms timestamp of last shot
let lastShotMs = 0
export function getLastShotMs() { return lastShotMs }

export function setWeaponEntity(e: Entity | undefined) { weaponEntity = e }

export function pauseShooter()  { shooterPaused = true }
export function resumeShooter() { shooterPaused = false }

export function activateShooter()  { shooterActive = true; shooterPaused = false }
export function deactivateShooter() {
  shooterActive = false
  for (const b of bullets) engine.removeEntity(b.entity)
  bullets.length = 0
  for (const v of vfxList) engine.removeEntity(v.entity)
  vfxList.length = 0
}

export function tryFireBulletFromUi(): boolean {
  if (!shooterActive || shooterPaused || fireCooldown > 0) return false
  fireBullet()
  fireCooldown = FIRE_COOLDOWN
  return true
}

engine.addSystem((dt: number) => {
  if (!shooterActive || shooterPaused) return

  if (fireCooldown > 0) fireCooldown -= dt

  // Continuous aim sync
  aimFrameTimer += dt
  if (aimFrameTimer >= AIM_INTERVAL) {
    aimFrameTimer = 0
    const cam = Transform.getOrNull(engine.CameraEntity)
    if (cam) room.send('aimUpdate', { rx: cam.rotation.x, ry: cam.rotation.y, rz: cam.rotation.z, rw: cam.rotation.w })
  }

  if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN) && fireCooldown <= 0) {
    fireBullet()
    fireCooldown = FIRE_COOLDOWN
  }

  // — Tick VFX lifetime —
  for (let i = vfxList.length - 1; i >= 0; i--) {
    vfxList[i].lifetime -= dt
    if (vfxList[i].lifetime <= 0) {
      engine.removeEntity(vfxList[i].entity)
      vfxList.splice(i, 1)
    }
  }

  // — Move bullets + hit detection —
  const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]
    b.lifetime -= dt
    if (b.lifetime <= 0) {
      engine.removeEntity(b.entity)
      bullets.splice(i, 1)
      continue
    }

    const t = Transform.getMutable(b.entity)
    t.position = {
      x: t.position.x + b.vx * dt,
      y: t.position.y + b.vy * dt,
      z: t.position.z + b.vz * dt,
    }

    let hit = false
    for (const [, identity, transform] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
      if (identity.address.toLowerCase() === myAddress) continue
      const dx = transform.position.x - t.position.x
      const dy = transform.position.y - t.position.y
      const dz = transform.position.z - t.position.z
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < HIT_RADIUS) {
        room.send('shoot', { targetAddress: identity.address.toLowerCase() })
        engine.removeEntity(b.entity)
        bullets.splice(i, 1)
        hit = true
        break
      }
    }
    if (hit) continue
  }
})

function fireBullet() {
  const cam = Transform.getOrNull(engine.CameraEntity)
  if (!cam) return

  lastShotMs = Date.now()

  const fwd = Vector3.rotate(Vector3.Forward(), cam.rotation)

  // — Bullet —
  const bulletEnt = engine.addEntity()
  GltfContainer.create(bulletEnt, {
    src: BULLET_SRC,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
  })
  Transform.create(bulletEnt, {
    position: cam.position,
    rotation: cam.rotation,
    scale: { x: 0.18, y: 0.18, z: 0.18 },
  })
  bullets.push({ entity: bulletEnt, vx: fwd.x * BULLET_SPEED, vy: fwd.y * BULLET_SPEED, vz: fwd.z * BULLET_SPEED, lifetime: BULLET_LIFE })

  // Muzzle position: player arm height + right + forward (matches world-space weapon model)
  const player = Transform.getOrNull(engine.PlayerEntity)
  const right  = Vector3.rotate(Vector3.Right(), cam.rotation)
  const muzzle = {
    x: (player?.position.x ?? cam.position.x) + right.x * 0.45 + fwd.x * 0.35,
    y: (player?.position.y ?? cam.position.y) + 1.15,
    z: (player?.position.z ?? cam.position.z) + right.z * 0.45 + fwd.z * 0.35,
  }
  room.send('fireShot', { px: muzzle.x, py: muzzle.y, pz: muzzle.z, rx: cam.rotation.x, ry: cam.rotation.y, rz: cam.rotation.z, rw: cam.rotation.w })
  playGunshotAt(muzzle.x, muzzle.y, muzzle.z)

  // — Muzzle flash VFX parented to weapon —
  if (weaponEntity !== undefined) {
    const vfxEnt = engine.addEntity()
    GltfContainer.create(vfxEnt, {
      src: VFX_SRC,
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    })
    Transform.create(vfxEnt, {
      parent: weaponEntity,
      // muzzle tip in weapon-local space (weapon scale 0.02, rotated 90°Y, barrel along local -X)
      position: { x: -30, y: 5, z: 0 },
      rotation: Quaternion.fromEulerDegrees(0, -90, 0),
      scale: { x: 30, y: 30, z: 30 },
    })
    vfxList.push({ entity: vfxEnt, lifetime: VFX_LIFE })
  }
}
