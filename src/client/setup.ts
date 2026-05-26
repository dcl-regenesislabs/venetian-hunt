import { engine, PlayerIdentityData, MainCamera, InputModifier, Entity } from '@dcl/sdk/ecs'
import { DisguisedPlayersComponent, RolesComponent } from '../shared/schemas'
import { isStateSyncronized } from '@dcl/sdk/network'
import { movePlayerTo } from '~system/RestrictedActions'
import { room } from '../shared/messages'
import { activateAvatarHiding, deactivateAvatarHiding } from '../avatarHiding'
import { setLocalPlayerAddress, syncRemoteDisguises, onPlayerDisguised, onPlayerUndisguised, blinkPlayerProp, clearAllProps } from './propSystem'
import { updateShooterWeapons, clearShooterWeapons, setShooterWeaponsVisible, updateShooterAim, getShooterMuzzleWorld } from './shooterWeapons'
import { spawnRemoteBullet, spawnRemoteVfx } from './remoteBullets'
import { setPlayerRole, blinkLocalProp, resetForLobby, clearLocalProp, reattachProp, showRoleArrow, hideRoleArrow, enableShooterLoadout, disableShooterLoadout } from '../ui'
import { pauseShooter, resumeShooter } from './shooterSystem'
import { playGunshotAt } from './audioManager'
import { onHiderHit } from './hiderHealth'
import { spawnRandomProps, clearProps } from '../props'

const SPAWN = { x: 43.5, y: 2.75, z: 4 }
const HIDER_SPAWN = { x: 43.1, y: 6, z: 55.4 }

const HIDER_SLOTS = [
  { x: 37.65, y: 2.40, z: 6.75 },
  { x: 36.00, y: 2.50, z: 6.75 },
  { x: 39.00, y: 2.50, z: 6.75 },
]
const SHOOTER_SLOTS = [
  { x: 50.45, y: 2.40, z: 6.75 },
  { x: 48.80, y: 2.50, z: 6.75 },
  { x: 51.80, y: 2.50, z: 6.75 },
]

const DISGUISED_ENTITY = 3 as Entity
const ROLES_ENTITY = 2 as Entity
let synced = false
let localRole: 'hider' | 'shooter' = 'hider'
let cinematicSlotIndex = 0
let cinematicCamEntity: Entity | undefined
let cinematicTargetEntity: Entity | undefined
let currentShooterAddresses: string[] = []

function syncRolesFromState(myAddress?: string) {
  const roles = RolesComponent.getOrNull(ROLES_ENTITY)
  if (!roles) return

  currentShooterAddresses = roles.shooters.map((address) => address.toLowerCase())
  uiState.hidersLeft = roles.hiders.length

  if (!myAddress) return

  const nextRole: 'hider' | 'shooter' = roles.hiders.some((h) => h.toLowerCase() === myAddress) ? 'hider' : 'shooter'
  if (roles.hiders.length + roles.shooters.length === 0) return
  if (nextRole === localRole) return

  localRole = nextRole
  setPlayerRole(localRole, true)
}

function startCinematic() {
  lockPlayerMovement()
  pauseShooter()

  const slots = localRole === 'hider' ? HIDER_SLOTS : SHOOTER_SLOTS
  const dest = slots[cinematicSlotIndex] ?? slots[0]
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
    mode: InputModifier.Mode.Standard({ disableAll: true }),
  })
}

function unlockPlayerMovement() {
  InputModifier.createOrReplace(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({ disableAll: false }),
  })
}

function movePlayerAndThen(position: { x: number; y: number; z: number }, afterMove: () => void) {
  movePlayerTo({ newRelativePosition: position })
    .catch(() => {})
    .finally(afterMove)
}

export const uiState = {
  phase: 'lobby' as string,
  hideSecondsLeft: 0,
  playingSecondsLeft: 0,
  hidersLeft: 0,
  winner: '' as '' | 'shooters' | 'hiders',
  eliminated: false,
  localHealth: 10,
  serverConnected: false,
  lobbyPlayerCount: 0,
  lobbyReadyCount: 0,
  lobbyCanStart: false,
}

export function getCurrentPhase() {
  return uiState.phase
}

export function initClient() {
  engine.addSystem(() => {
    if (synced || !isStateSyncronized()) return
    synced = true
    room.send('playerReady', {})
  })

  engine.addSystem(() => {
    const phase = uiState.phase
    const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
    if (myAddress) setLocalPlayerAddress(myAddress)
    syncRolesFromState(myAddress)

    if (phase !== 'hiding' && phase !== 'playing') {
      updateShooterWeapons(currentShooterAddresses, myAddress ?? '', { includeLocal: false, mode: 'active' })
      setShooterWeaponsVisible(false)
      deactivateAvatarHiding()
      return
    }

    activateAvatarHiding()
    updateShooterWeapons(currentShooterAddresses, myAddress ?? '', {
      includeLocal: phase === 'hiding' && localRole === 'shooter',
      mode: phase === 'hiding' ? 'waiting' : 'active',
    })
    setShooterWeaponsVisible(true)

    const disguised = DisguisedPlayersComponent.getOrNull(DISGUISED_ENTITY)
    if (disguised) {
      syncRemoteDisguises(disguised.disguises)
    }
  })

  room.onMessage('rolesAssigned', (data) => {
    console.log('[Client] Roles assigned - shooters:', data.shooters)
    currentShooterAddresses = data.shooters.map((address: string) => address.toLowerCase())

    const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
    const isHider = !!myAddress && data.hiders.map((h: string) => h.toLowerCase()).includes(myAddress)
    localRole = isHider ? 'hider' : 'shooter'
    uiState.hidersLeft = data.hiders.length

    const myTeam = isHider ? data.hiders : data.shooters
    const myIdx = myAddress ? myTeam.findIndex((a: string) => a.toLowerCase() === myAddress) : 0
    cinematicSlotIndex = Math.max(0, myIdx) % 3

    uiState.localHealth = 10
    setPlayerRole(localRole, true)
    updateShooterWeapons(currentShooterAddresses, myAddress ?? '', { includeLocal: false, mode: 'active' })
    setShooterWeaponsVisible(false)
  })

  room.onMessage('gamePhaseChanged', (data) => {
    console.log('[Client] Phase:', data.phase)
    uiState.phase = data.phase

    if (data.phase === 'cinematic') {
      startCinematic()
    }

    if (data.phase === 'lobby') {
      stopCinematic()
      unlockPlayerMovement()
      currentShooterAddresses = []
      clearShooterWeapons()
      resetForLobby()
      clearAllProps()
      clearProps()
      localRole = 'hider'
      cinematicSlotIndex = 0
      uiState.hideSecondsLeft = 0
      uiState.playingSecondsLeft = 0
      uiState.winner = ''
      uiState.eliminated = false
      uiState.localHealth = 10
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
    }

    if (data.phase === 'playing') {
      stopCinematic()
      resumeShooter()
      uiState.eliminated = false
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

  room.onMessage('propsSpawned', (data) => {
    spawnRandomProps(data.seed)
  })

  room.onMessage('hideCountdown', (data) => {
    uiState.hideSecondsLeft = data.seconds
  })

  room.onMessage('playingTimer', (data) => {
    uiState.playingSecondsLeft = data.secondsLeft
    uiState.hidersLeft = data.hidersLeft
  })

  room.onMessage('gameResults', (data) => {
    uiState.winner = data.winner as 'shooters' | 'hiders'
  })

  room.onMessage('lobbyState', (data) => {
    uiState.serverConnected = true
    uiState.lobbyPlayerCount = data.connectedCount
    uiState.lobbyReadyCount = data.readyCount
    uiState.lobbyCanStart = data.canStart
  })

  room.onMessage('playerDisguised', (data) => {
    onPlayerDisguised(data.address, data.propSrc)
  })

  room.onMessage('playerUndisguised', (data) => {
    onPlayerUndisguised(data.address)
  })

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
      uiState.eliminated = true
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
