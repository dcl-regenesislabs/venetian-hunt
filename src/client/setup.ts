import { engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'
import { movePlayerTo } from '~system/RestrictedActions'
import { room } from '../shared/messages'
import { updateShooterIds, addVisiblePlayer, removeVisiblePlayer, resetVisibility } from '../avatarHiding'
import { onPlayerDisguised, onPlayerUndisguised, blinkPlayerProp, clearAllProps } from './propSystem'
import { updateShooterWeapons, clearShooterWeapons, updateShooterAim } from './shooterWeapons'
import { spawnRemoteBullet } from './remoteBullets'
import { setPlayerRole, blinkLocalProp, resetForLobby } from '../ui'
import { pauseShooter, resumeShooter } from './shooterSystem'
import { onHiderHit } from './hiderHealth'

const SPAWN        = { x: 43.5, y: 2.75, z: 4 }
const HIDER_SPAWN  = { x: 47.1, y: 5,    z: 56.4 }

let synced     = false
let localRole: 'hider' | 'shooter' = 'hider'

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

    uiState.localHealth = 10
    setPlayerRole(localRole)
    updateShooterWeapons(data.shooters, myAddress ?? '')
  })

  // --- Phase changes ---
  room.onMessage('gamePhaseChanged', (data) => {
    console.log('[Client] Phase:', data.phase)
    uiState.phase = data.phase

    if (data.phase === 'lobby') {
      resetVisibility()
      clearShooterWeapons()
      resetForLobby()
      clearAllProps()
      localRole                  = 'hider'
      uiState.hideSecondsLeft    = 0
      uiState.playingSecondsLeft = 0
      uiState.winner             = ''
      uiState.eliminated         = false
      uiState.localHealth        = 10
      movePlayerTo({ newRelativePosition: SPAWN })
    }

    if (data.phase === 'hiding') {
      pauseShooter()
      // Hiders run to hide; shooters wait at spawn
      const dest = localRole === 'hider' ? HIDER_SPAWN : SPAWN
      movePlayerTo({ newRelativePosition: dest })
    }

    if (data.phase === 'playing') {
      resumeShooter()
      uiState.eliminated         = false
      uiState.playingSecondsLeft = 180
      if (localRole === 'shooter') {
        movePlayerTo({ newRelativePosition: HIDER_SPAWN })
      }
    }

    if (data.phase === 'results') {
      movePlayerTo({ newRelativePosition: SPAWN })
    }
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
      blinkLocalProp()
      uiState.eliminated = true
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
      spawnRemoteBullet({ x: data.px, y: data.py, z: data.pz }, { x: data.rx, y: data.ry, z: data.rz, w: data.rw })
    }
  })
}
