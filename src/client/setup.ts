import { engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'
import { room } from '../shared/messages'
import { updateShooterIds, addVisiblePlayer, removeVisiblePlayer, resetVisibility } from '../avatarHiding'
import { onPlayerDisguised, onPlayerUndisguised, blinkPlayerProp } from './propSystem'
import { updateShooterWeapons, clearShooterWeapons, updateShooterAim } from './shooterWeapons'
import { spawnRemoteBullet } from './remoteBullets'
import { getCurrentPropSrc, setPlayerRole, blinkLocalProp } from '../ui'

let synced = false

export function initClient() {
  // Wait for state sync then announce presence
  engine.addSystem(() => {
    if (synced || !isStateSyncronized()) return
    synced = true
    room.send('playerReady', {})
  })

  room.onMessage('rolesAssigned', (data) => {
    console.log('[Client] Roles assigned — shooters:', data.shooters)
    updateShooterIds(data.shooters)

    const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
    const isHider = !!myAddress && data.hiders.map((h: string) => h.toLowerCase()).includes(myAddress)
    setPlayerRole(isHider ? 'hider' : 'shooter')
    updateShooterWeapons(data.shooters, myAddress ?? '')
    if (isHider) {
      const propSrc = getCurrentPropSrc()
      if (propSrc !== '') room.send('selectProp', { propSrc })
    }
  })

  room.onMessage('gamePhaseChanged', (data) => {
    console.log('[Client] Phase:', data.phase)
    if (data.phase === 'lobby') { resetVisibility(); clearShooterWeapons() }
  })

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

  room.onMessage('playerEliminated', (data) => {
    const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
    if (data.address === myAddress) {
      blinkLocalProp()
    } else {
      blinkPlayerProp(data.address)
    }
  })
}
