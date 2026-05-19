import { engine, PlayerIdentityData, MainCamera, InputModifier, Transform, Entity } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'
import { movePlayerTo } from '~system/RestrictedActions'
import { room } from '../shared/messages'
import { updateShooterIds, addVisiblePlayer, removeVisiblePlayer, resetVisibility } from '../avatarHiding'
import { onPlayerDisguised, onPlayerUndisguised, blinkPlayerProp, clearAllProps } from './propSystem'
import { updateShooterWeapons, clearShooterWeapons, updateShooterAim, getShooterMuzzleWorld } from './shooterWeapons'
import { spawnRemoteBullet, spawnRemoteVfx } from './remoteBullets'
import { setPlayerRole, blinkLocalProp, resetForLobby, clearLocalProp, reattachProp, showRoleArrow, hideRoleArrow, enableShooterLoadout, disableShooterLoadout } from '../ui'
import { pauseShooter, resumeShooter } from './shooterSystem'
import { playGunshotAt } from './audioManager'
import { onHiderHit } from './hiderHealth'
import { spawnRandomProps, clearProps } from '../props'

const SPAWN       = { x: 43.5, y: 2.75, z: 4 }
const HIDER_SPAWN = { x: 48.1, y: 6,    z: 57.4 }

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

function startCinematic() {
  lockPlayerMovement()
  pauseShooter()

  const slots = localRole === 'hider' ? HIDER_SLOTS : SHOOTER_SLOTS
  const dest  = slots[cinematicSlotIndex] ?? slots[0]
  movePlayerTo({ newRelativePosition: dest })

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
  hideRoleArrow()
}

function lockPlayerMovement() {
  InputModifier.createOrReplace(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({ disableAll: true })
  })
}

function unlockPlayerMovement() {
  InputModifier.createOrReplace(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({ disableAll: false })
  })
}

function movePlayerAndUnlock(position: { x: number, y: number, z: number }) {
  movePlayerTo({ newRelativePosition: position })
    .catch(() => {})
    .finally(() => unlockPlayerMovement())
}

function movePlayerAndThen(position: { x: number, y: number, z: number }, afterMove: () => void) {
  movePlayerTo({ newRelativePosition: position })
    .catch(() => {})
    .finally(afterMove)
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

export function initClient() {
  engine.addSystem(() => {
    if (synced || !isStateSyncronized()) return
    synced = true
    room.send('playerReady', {})
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
    updateShooterIds(data.shooters)

    const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
    const isHider   = !!myAddress && data.hiders.map((h: string) => h.toLowerCase()).includes(myAddress)
    localRole      = isHider ? 'hider' : 'shooter'
    uiState.hidersLeft = data.hiders.length

    // Determine boat slot index (0=center, 1=left, 2=right) based on position in team list
    const myTeam = isHider ? data.hiders : data.shooters
    const myIdx  = myAddress ? myTeam.findIndex((a: string) => a.toLowerCase() === myAddress) : 0
    cinematicSlotIndex = Math.max(0, myIdx) % 3

    uiState.localHealth = 10
    // skipProp=true: during cinematic hiders appear as avatars; prop is attached when hiding starts
    setPlayerRole(localRole, true)
    updateShooterWeapons(data.shooters, myAddress ?? '')
  })

  // --- Phase changes ---
  room.onMessage('gamePhaseChanged', (data) => {
    console.log('[Client] Phase:', data.phase)
    uiState.phase = data.phase

    if (data.phase === 'cinematic') {
      startCinematic()
    }

    if (data.phase === 'lobby') {
      stopCinematic()
      unlockPlayerMovement()
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
      movePlayerTo({ newRelativePosition: SPAWN })
    }

    if (data.phase === 'hiding') {
      pauseShooter()
      if (localRole === 'hider') {
        stopCinematic()
        unlockPlayerMovement()
        reattachProp()
        movePlayerTo({ newRelativePosition: HIDER_SPAWN }).catch(() => {})
      } else {
        disableShooterLoadout()
      }
      // Shooters stay on their boat with camera and movement locked until playing
    }

    if (data.phase === 'playing') {
      stopCinematic()
      resumeShooter()
      uiState.eliminated         = false
      uiState.playingSecondsLeft = 180
      if (localRole === 'shooter') {
        disableShooterLoadout()
        movePlayerAndThen(HIDER_SPAWN, () => {
          enableShooterLoadout()
          unlockPlayerMovement()
        })
      } else {
        unlockPlayerMovement()
      }
    }

    if (data.phase === 'results') {
      stopCinematic()
      unlockPlayerMovement()
    }
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
