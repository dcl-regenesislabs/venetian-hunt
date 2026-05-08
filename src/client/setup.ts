import { engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'
import { room } from '../shared/messages'
import { updateShooterIds } from '../avatarHiding'
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

    // Re-send current prop — the initial selectProp was dropped because the game hadn't started yet
    const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
    const isHider = !!myAddress && data.hiders.map((h: string) => h.toLowerCase()).includes(myAddress)
    setPlayerRole(isHider ? 'hider' : 'shooter')
    if (isHider) {
      room.send('selectProp', { propSrc: getCurrentPropSrc() })
    }
  })

  room.onMessage('gamePhaseChanged', (data) => {
    console.log('[Client] Phase:', data.phase)
    if (data.phase === 'lobby') updateShooterIds([])
  })

  room.onMessage('playerDisguised', (data) => {
    onPlayerDisguised(data.address, data.propSrc)
  })

  room.onMessage('playerUndisguised', (data) => {
    onPlayerUndisguised(data.address)
  })
}
