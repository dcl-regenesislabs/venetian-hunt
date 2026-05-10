import { engine, Entity, PlayerIdentityData } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { room } from '../shared/messages'
import { GameStateComponent, RolesComponent, DisguisedPlayersComponent } from '../shared/schemas'
import { PROP_SPAWN_POINTS } from '../propSpawnPoints'

const VALID_PROP_SRCS = new Set(Object.keys(PROP_SPAWN_POINTS))
const MIN_PLAYERS_TO_START = 2

// 1 shooter per every 3 hiders, minimum 1 shooter
function assignRoles(addresses: string[]): { shooters: string[]; hiders: string[] } {
  // DEBUG: everyone is a hider
  return { shooters: [], hiders: [...addresses] }
}

export function initServer() {
  console.log('[Server] Prop Hunt server starting...')

  // --- Synced game state entities (IDs 1-3 reserved) ---
  const gameEntity: Entity = 1 as Entity
  GameStateComponent.create(gameEntity, { phase: 'lobby' })
  syncEntity(gameEntity, [GameStateComponent.componentId], 1)

  const rolesEntity: Entity = 2 as Entity
  RolesComponent.create(rolesEntity, { shooters: [], hiders: [] })
  syncEntity(rolesEntity, [RolesComponent.componentId], 2)

  const disguisedEntity: Entity = 3 as Entity
  DisguisedPlayersComponent.create(disguisedEntity, { disguises: [] })
  syncEntity(disguisedEntity, [DisguisedPlayersComponent.componentId], 3)

  // --- Track connected players ---
  const connectedPlayers = new Set<string>()

  engine.addSystem(() => {
    for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
      const addr = identity.address.toLowerCase()
      if (!connectedPlayers.has(addr)) {
        connectedPlayers.add(addr)
        console.log(`[Server] Player joined: ${addr} (total: ${connectedPlayers.size})`)
        tryStartGame()
      }
    }
    // Detect disconnects
    const current = new Set<string>()
    for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
      current.add(identity.address.toLowerCase())
    }
    for (const addr of connectedPlayers) {
      if (!current.has(addr)) {
        connectedPlayers.delete(addr)
        onPlayerLeft(addr)
      }
    }
  })

  function tryStartGame() {
    const phase = GameStateComponent.get(gameEntity).phase
    if (phase !== 'lobby') return
    if (connectedPlayers.size < MIN_PLAYERS_TO_START) return

    const roles = assignRoles([...connectedPlayers])
    RolesComponent.createOrReplace(rolesEntity, roles)
    GameStateComponent.createOrReplace(gameEntity, { phase: 'playing' })

    room.send('rolesAssigned', roles)
    room.send('gamePhaseChanged', { phase: 'playing' })
    console.log(`[Server] Game started — shooters: ${roles.shooters}, hiders: ${roles.hiders}`)
  }

  function onPlayerLeft(address: string) {
    console.log(`[Server] Player left: ${address}`)
    // Remove their disguise if any
    const state = DisguisedPlayersComponent.getMutable(disguisedEntity)
    const before = state.disguises.length
    state.disguises = state.disguises.filter(d => d.address !== address)
    if (state.disguises.length !== before) {
      room.send('playerUndisguised', { address })
    }
    // If game is now under min players, reset to lobby
    if (connectedPlayers.size < MIN_PLAYERS_TO_START) {
      GameStateComponent.createOrReplace(gameEntity, { phase: 'lobby' })
      RolesComponent.createOrReplace(rolesEntity, { shooters: [], hiders: [] })
      DisguisedPlayersComponent.createOrReplace(disguisedEntity, { disguises: [] })
      room.send('gamePhaseChanged', { phase: 'lobby' })
    }
  }

  // --- Client messages ---
  room.onMessage('selectProp', (data, context) => {
    if (!context) return
    const address = context.from.toLowerCase()
    const phase = GameStateComponent.get(gameEntity).phase
    if (phase !== 'playing') return

    // Validate: must be a hider
    const roles = RolesComponent.get(rolesEntity)
    if (!roles.hiders.includes(address)) return

    // Validate: must be a known prop
    if (!VALID_PROP_SRCS.has(data.propSrc)) return

    const state = DisguisedPlayersComponent.getMutable(disguisedEntity)
    const existing = state.disguises.findIndex(d => d.address === address)
    if (existing >= 0) {
      state.disguises[existing] = { address, propSrc: data.propSrc }
    } else {
      state.disguises.push({ address, propSrc: data.propSrc })
    }

    room.send('playerDisguised', { address, propSrc: data.propSrc })
    console.log(`[Server] ${address} disguised as ${data.propSrc}`)
  })

  room.onMessage('aimUpdate', (data, context) => {
    if (!context) return
    const shooterAddr = context.from.toLowerCase()
    const roles = RolesComponent.get(rolesEntity)
    if (!roles.shooters.includes(shooterAddr)) return
    room.send('shooterAim', { shooterAddress: shooterAddr, rx: data.rx, ry: data.ry, rz: data.rz, rw: data.rw })
  })

  room.onMessage('fireShot', (data, context) => {
    if (!context) return
    const shooterAddr = context.from.toLowerCase()
    const roles = RolesComponent.get(rolesEntity)
    if (!roles.shooters.includes(shooterAddr)) return
    room.send('shotFired', { shooterAddress: shooterAddr, px: data.px, py: data.py, pz: data.pz, rx: data.rx, ry: data.ry, rz: data.rz, rw: data.rw })
  })

  room.onMessage('shoot', (data, context) => {
    if (!context) return
    const shooterAddr = context.from.toLowerCase()
    const targetAddr  = data.targetAddress.toLowerCase()
    const roles = RolesComponent.get(rolesEntity)
    if (!roles.shooters.includes(shooterAddr)) return
    if (!roles.hiders.includes(targetAddr)) return
    console.log(`[Server] ${shooterAddr} hit ${targetAddr}`)
    room.send('playerEliminated', { address: targetAddr })
  })

  room.onMessage('debugSwitchRole', (_, context) => {
    if (!context) return
    const address = context.from.toLowerCase()
    const roles = RolesComponent.get(rolesEntity)
    let shooters = [...roles.shooters]
    let hiders   = [...roles.hiders]

    if (shooters.includes(address)) {
      shooters = shooters.filter(a => a !== address)
      hiders   = [...hiders, address]
    } else if (hiders.includes(address)) {
      hiders   = hiders.filter(a => a !== address)
      shooters = [...shooters, address]
    }

    RolesComponent.createOrReplace(rolesEntity, { shooters, hiders })
    room.send('rolesAssigned', { shooters, hiders })
    console.log(`[Server] ${address} switched role — shooters: ${shooters}`)
  })

  room.onMessage('undisguise', (_, context) => {
    if (!context) return
    const address = context.from.toLowerCase()
    const state = DisguisedPlayersComponent.getMutable(disguisedEntity)
    const before = state.disguises.length
    state.disguises = state.disguises.filter(d => d.address !== address)
    if (state.disguises.length !== before) {
      room.send('playerUndisguised', { address })
      console.log(`[Server] ${address} went back to avatar`)
    }
  })

  room.onMessage('playerReady', (_, context) => {
    if (!context) return
    console.log(`[Server] playerReady from ${context.from}`)
    tryStartGame()
  })
}
