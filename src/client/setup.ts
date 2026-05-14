import { engine, PlayerIdentityData, VirtualCamera, MainCamera, InputModifier, Transform, Entity } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'
import { movePlayerTo } from '~system/RestrictedActions'
import { room } from '../shared/messages'
import { updateShooterIds, addVisiblePlayer, removeVisiblePlayer, resetVisibility } from '../avatarHiding'
import { onPlayerDisguised, onPlayerUndisguised, blinkPlayerProp, clearAllProps } from './propSystem'
import { updateShooterWeapons, clearShooterWeapons, updateShooterAim, getShooterMuzzleWorld } from './shooterWeapons'
import { spawnRemoteBullet, spawnRemoteVfx } from './remoteBullets'
import { setPlayerRole, blinkLocalProp, resetForLobby, clearLocalProp, reattachProp, restoreLocalProp, createCinematicWeapon, removeCinematicWeapon, showRoleArrow, hideRoleArrow } from '../ui'
import { pauseShooter, resumeShooter } from './shooterSystem'
import { playGunshotAt } from './audioManager'
import { onHiderHit } from './hiderHealth'
import { spawnRandomProps, clearProps } from '../props'

const SPAWN       = { x: 43.5, y: 2.75, z: 4 }
const HIDER_SPAWN = { x: 45.75, y: 10,  z: 57.25 }
const GAME_AREA_FALLBACK_Y         = 2
const GAME_AREA_GUARD_RADIUS       = 14
const GAME_AREA_GUARD_FRAMES       = 240

// center, left, right slots — world positions computed from composite (boat scale 1.2, no rotation)
const HIDER_SLOTS = [
  { x: 37.65, y: 2.40, z: 6.75 },  // center
  { x: 36.00, y: 2.50, z: 6.75 },  // left
  { x: 39.00, y: 2.50, z: 6.75 },  // right
]
const SHOOTER_SLOTS = [
  { x: 50.45, y: 2.40, z: 6.75 },  // center
  { x: 48.80, y: 2.50, z: 6.75 },  // left
  { x: 51.80, y: 2.50, z: 6.75 },  // right
]
const CINEMATIC_CAM_POS     = { x: 43.5,   y: 5.0, z: -3.0  }
const CINEMATIC_LOOK_AT_POS = { x: 43.625, y: 3.0, z: 6.75  }

let synced             = false
let localRole: 'hider' | 'shooter' = 'hider'
let cinematicSlotIndex = 0
let cinematicCamEntity:    Entity | undefined
let cinematicTargetEntity: Entity | undefined
let gameAreaGuardFrames = 0
let gameAreaRecovering  = false

function armGameAreaSpawnGuard() {
  gameAreaGuardFrames = GAME_AREA_GUARD_FRAMES
  gameAreaRecovering  = false
}

function startCinematic() {
  InputModifier.create(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({ disableAll: true })
  })

  const slots = localRole === 'hider' ? HIDER_SLOTS : SHOOTER_SLOTS
  const dest  = slots[cinematicSlotIndex] ?? slots[0]
  movePlayerTo({ newRelativePosition: dest, cameraTarget: CINEMATIC_CAM_POS })

  cinematicTargetEntity = engine.addEntity()
  Transform.create(cinematicTargetEntity, { position: CINEMATIC_LOOK_AT_POS })

  cinematicCamEntity = engine.addEntity()
  Transform.create(cinematicCamEntity, { position: CINEMATIC_CAM_POS })
  VirtualCamera.create(cinematicCamEntity, {
    lookAtEntity: cinematicTargetEntity,
    defaultTransition: { transitionMode: VirtualCamera.Transition.Time(1.5) }
  })
  MainCamera.getMutable(engine.CameraEntity).virtualCameraEntity = cinematicCamEntity

  createCinematicWeapon()
  showRoleArrow(localRole)
}

function stopCinematic() {
  if (cinematicCamEntity !== undefined) {
    if (MainCamera.has(engine.CameraEntity)) {
      MainCamera.getMutable(engine.CameraEntity).virtualCameraEntity = undefined
    }
    engine.removeEntity(cinematicCamEntity)
    cinematicCamEntity = undefined
  }
  if (cinematicTargetEntity !== undefined) {
    engine.removeEntity(cinematicTargetEntity)
    cinematicTargetEntity = undefined
  }
  if (InputModifier.has(engine.PlayerEntity)) {
    InputModifier.deleteFrom(engine.PlayerEntity)
  }
  removeCinematicWeapon()
  hideRoleArrow()
}

// Shared UI state — read by ui.tsx every render frame
export const uiState = {
  phase:              'lobby' as string,
  hideSecondsLeft:    0,
  playingSecondsLeft: 0,
  hidersLeft:         0,
  winner:             '' as '' | 'shooters' | 'hiders',
  eliminated:         false,
  localHealth:        10,
}

export function getCurrentPhase() { return uiState.phase }

type DisguiseSnapshot = { address: string; propSrc: string }
type HealthSnapshot   = { address: string; health: number }

function getLocalAddress(): string | undefined {
  return PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
}

function syncRoles(shooters: string[], hiders: string[]) {
  console.log('[Client] Roles assigned - shooters:', shooters)
  updateShooterIds(shooters)

  const normalizedShooters = shooters.map((a) => a.toLowerCase())
  const normalizedHiders   = hiders.map((a) => a.toLowerCase())
  const myAddress          = getLocalAddress()
  const isHider            = !!myAddress && normalizedHiders.includes(myAddress)

  localRole          = isHider ? 'hider' : 'shooter'
  uiState.hidersLeft = hiders.length

  const myTeam = isHider ? normalizedHiders : normalizedShooters
  const myIdx  = myAddress ? myTeam.findIndex((a) => a === myAddress) : 0
  cinematicSlotIndex = Math.max(0, myIdx) % 3

  setPlayerRole(localRole, true)
  updateShooterWeapons(shooters, myAddress ?? '')

  return myAddress
}

function applyPhaseState(phase: string, options?: { fromSync?: boolean; localEliminated?: boolean }) {
  const fromSync        = options?.fromSync ?? false
  const localEliminated = options?.localEliminated ?? false

  uiState.phase = phase

  if (phase === 'cinematic') {
    uiState.eliminated = false
    startCinematic()
  }

  if (phase === 'lobby') {
    stopCinematic()
    resetVisibility()
    clearShooterWeapons()
    resetForLobby()
    clearAllProps()
    clearProps()
    localRole                  = 'hider'
    cinematicSlotIndex         = 0
    uiState.hideSecondsLeft    = 0
    uiState.playingSecondsLeft = 0
    uiState.winner             = ''
    uiState.eliminated         = false
    uiState.localHealth        = 10
    gameAreaGuardFrames        = 0
    gameAreaRecovering         = false
    movePlayerTo({ newRelativePosition: SPAWN })
  }

  if (phase === 'hiding') {
    pauseShooter()
    uiState.eliminated = false
    if (localRole === 'hider') {
      stopCinematic()
      if (!fromSync) reattachProp()
      armGameAreaSpawnGuard()
      movePlayerTo({ newRelativePosition: HIDER_SPAWN })
    }
  }

  if (phase === 'playing') {
    stopCinematic()
    resumeShooter()
    uiState.eliminated = localEliminated
    if (!fromSync) uiState.playingSecondsLeft = 180

    if (localRole === 'shooter') {
      armGameAreaSpawnGuard()
      movePlayerTo({ newRelativePosition: HIDER_SPAWN })
    } else if (localEliminated) {
      clearLocalProp()
      movePlayerTo({ newRelativePosition: SPAWN })
    }
  }

  if (phase === 'results') {
    stopCinematic()
  }
}

function applyDisguiseSnapshot(disguises: DisguiseSnapshot[], localEliminated = false) {
  clearAllProps()

  const myAddress   = getLocalAddress()
  const disguisedSet = new Set<string>()

  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const addr = identity.address?.toLowerCase()
    if (addr) addVisiblePlayer(addr)
  }

  for (const disguise of disguises) {
    const normalized = disguise.address.toLowerCase()
    disguisedSet.add(normalized)
    if (normalized === myAddress) {
      if (localRole === 'hider' && !localEliminated) {
        restoreLocalProp(disguise.propSrc)
      }
    } else {
      onPlayerDisguised(normalized, disguise.propSrc)
    }
    removeVisiblePlayer(normalized)
  }

  if (myAddress && !disguisedSet.has(myAddress) && localRole === 'hider') {
    addVisiblePlayer(myAddress)
  }
}

export function initClient() {
  engine.addSystem(() => {
    if (synced || !isStateSyncronized()) return
    synced = true
    room.send('playerReady', {})
  })

  // Multiworld streaming can make the distant island collider arrive a bit late on teleport.
  // Keep a short recovery window and snap the player back onto the game area if they start falling through.
  engine.addSystem(() => {
    if (gameAreaGuardFrames <= 0) return
    if (uiState.phase !== 'hiding' && uiState.phase !== 'playing') {
      gameAreaGuardFrames = 0
      gameAreaRecovering  = false
      return
    }

    gameAreaGuardFrames -= 1

    const playerTransform = Transform.getOrNull(engine.PlayerEntity)
    if (!playerTransform) return

    const dx = playerTransform.position.x - HIDER_SPAWN.x
    const dz = playerTransform.position.z - HIDER_SPAWN.z
    const withinGuardRadius = (dx * dx + dz * dz) <= (GAME_AREA_GUARD_RADIUS * GAME_AREA_GUARD_RADIUS)

    if (!withinGuardRadius) return
    if (playerTransform.position.y >= GAME_AREA_FALLBACK_Y) return
    if (gameAreaRecovering) return

    gameAreaRecovering = true
    movePlayerTo({ newRelativePosition: HIDER_SPAWN }).then(
      () => { gameAreaRecovering = false },
      () => { gameAreaRecovering = false }
    )
  })

  // Keep all players visible while in lobby (AvatarModifierArea hides everyone by default)
  engine.addSystem(() => {
    if (uiState.phase !== 'lobby') return
    for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
      const addr = identity.address?.toLowerCase()
      if (addr) addVisiblePlayer(addr)
    }
  })

  // --- Roles ---
  room.onMessage('rolesAssigned', (data) => {
    console.log('[Client] Roles assigned — shooters:', data.shooters)
    uiState.localHealth = 10
    syncRoles(data.shooters, data.hiders)
  })

  // --- Phase changes ---
  room.onMessage('gamePhaseChanged', (data) => {
    console.log('[Client] Phase:', data.phase)
    applyPhaseState(data.phase)
  })

  // --- Props ---
  room.onMessage('propsSpawned', (data) => {
    spawnRandomProps(data.seed)
  })

  // --- Timers ---
  room.onMessage('hideCountdown', (data) => {
    uiState.hideSecondsLeft = data.seconds
  })

  room.onMessage('playingTimer', (data) => {
    uiState.playingSecondsLeft = data.secondsLeft
    uiState.hidersLeft         = data.hidersLeft
  })

  room.onMessage('gameResults', (data) => {
    uiState.winner = data.winner as 'shooters' | 'hiders'
  })

  room.onMessage('stateSync', (data) => {
    console.log('[Client] stateSync phase:', data.phase)

    const myAddress = syncRoles(data.shooters, data.hiders)
    const healthByAddress = new Map<string, number>()
    for (const health of data.healths as HealthSnapshot[]) {
      healthByAddress.set(health.address.toLowerCase(), health.health)
    }

    const localHealth = myAddress ? healthByAddress.get(myAddress) : undefined
    const localEliminated = data.phase === 'playing' && localRole === 'hider' && localHealth === undefined

    uiState.hideSecondsLeft    = data.phase === 'hiding' ? data.secondsLeft : 0
    uiState.playingSecondsLeft = data.phase === 'playing' ? data.secondsLeft : 0
    uiState.hidersLeft         = data.hidersLeft
    uiState.winner             = data.winner as '' | 'shooters' | 'hiders'
    uiState.localHealth        = localEliminated ? 0 : (localHealth ?? 10)

    if (data.propSeed >= 0 && data.phase !== 'lobby') {
      spawnRandomProps(data.propSeed)
    } else {
      clearProps()
    }

    applyPhaseState(data.phase, { fromSync: true, localEliminated })
    applyDisguiseSnapshot(data.disguises as DisguiseSnapshot[], localEliminated)

    for (const health of data.healths as HealthSnapshot[]) {
      if (health.health < 10) onHiderHit(health.address, health.health)
    }
  })

  // --- Disguises ---
  room.onMessage('playerDisguised', (data) => {
    const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
    if (data.address.toLowerCase() !== myAddress) {
      onPlayerDisguised(data.address, data.propSrc)
    }
    removeVisiblePlayer(data.address)
  })

  room.onMessage('playerUndisguised', (data) => {
    onPlayerUndisguised(data.address)
    addVisiblePlayer(data.address)
  })

  // --- Combat ---
  room.onMessage('playerHit', (data) => {
    const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
    if (data.address.toLowerCase() === myAddress) {
      uiState.localHealth = data.health
      blinkLocalProp()
    } else {
      blinkPlayerProp(data.address)
      onHiderHit(data.address, data.health)
    }
  })

  room.onMessage('playerEliminated', (data) => {
    const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
    if (data.address === myAddress) {
      uiState.localHealth = 0
      uiState.eliminated  = true
      clearLocalProp()
      room.send('undisguise', {})
      movePlayerTo({ newRelativePosition: SPAWN })
    } else {
      blinkPlayerProp(data.address)
      onHiderHit(data.address, 0)
    }
    uiState.hidersLeft = Math.max(0, uiState.hidersLeft - 1)
  })

  room.onMessage('shooterAim', (data) => {
    updateShooterAim(data.shooterAddress, data.rx, data.ry, data.rz, data.rw)
  })

  room.onMessage('shotFired', (data) => {
    updateShooterAim(data.shooterAddress, data.rx, data.ry, data.rz, data.rw)
    const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
    if (data.shooterAddress !== myAddress) {
      const rot = { x: data.rx, y: data.ry, z: data.rz, w: data.rw }
      const sentPos = { x: data.px, y: data.py, z: data.pz }
      const vfxPos = getShooterMuzzleWorld(data.shooterAddress) ?? sentPos
      spawnRemoteBullet(sentPos, rot)
      spawnRemoteVfx(vfxPos, rot)
      playGunshotAt(data.px, data.py, data.pz)
    }
  })
}
