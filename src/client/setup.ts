import { engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'
import { room } from '../shared/messages'
import { updateShooterIds, addVisiblePlayer, removeVisiblePlayer, resetVisibility } from '../avatarHiding'
import { onPlayerDisguised, onPlayerUndisguised } from './propSystem'
import { getCurrentPropSrc, setPlayerRole } from '../ui'

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
    if (isHider) {
      const propSrc = getCurrentPropSrc()
      if (propSrc !== '') room.send('selectProp', { propSrc })
    }
  })

  room.onMessage('gamePhaseChanged', (data) => {
    console.log('[Client] Phase:', data.phase)
    if (data.phase === 'lobby') resetVisibility()
  })

  room.onMessage('playerDisguised', (data) => {
    onPlayerDisguised(data.address, data.propSrc)
    removeVisiblePlayer(data.address)
  })

  room.onMessage('playerUndisguised', (data) => {
    onPlayerUndisguised(data.address)
    addVisiblePlayer(data.address)
  })

  room.onMessage('playerEliminated', (data) => {
    const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
    if (data.address === myAddress) {
      console.log('[Client] You were eliminated!')
    } else {
      console.log(`[Client] ${data.address} was eliminated`)
    }
  })
}
