import { engine, Entity, PlayerIdentityData } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { room } from '../shared/messages'
import { GameStateComponent, RolesComponent, DisguisedPlayersComponent, GlobalLeaderboardComponent } from '../shared/schemas'
import { PROP_SPAWN_POINTS } from '../propSpawnPoints'
import { createLeaderboardStore } from './storage/leaderboard'

const VALID_PROP_SRCS      = new Set(Object.keys(PROP_SPAWN_POINTS))
const MIN_PLAYERS          = 2
const MAX_PLAYERS          = 6  // 3 per boat
const CINEMATIC_DURATION_S = 15
const HIDING_DURATION_S    = 30
const PLAYING_DURATION_S   = 180  // 3 minutes
const RESULTS_DURATION_S   = 8
const LEADERBOARD_ENTITY_ID = 4

// floor(n/2) shooters — odd remainder always goes to hiders (shooters always at disadvantage)
function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = tmp
  }
  return shuffled
}

function assignRoles(addresses: string[]): { shooters: string[]; hiders: string[] } {
  const capped       = shuffle(addresses).slice(0, MAX_PLAYERS)
  const shooterCount = Math.max(1, Math.floor(capped.length / 2))
  return {
    shooters: capped.slice(0, shooterCount),
    hiders:   capped.slice(shooterCount),
  }
}

export function initServer() {
  console.log('[Server] Prop Hunt server starting...')
  const leaderboardStore = createLeaderboardStore()

  // --- Synced entities (IDs 1-3 reserved) ---
  const gameEntity: Entity = 1 as Entity
  GameStateComponent.create(gameEntity, { phase: 'lobby' })
  syncEntity(gameEntity, [GameStateComponent.componentId], 1)

  const rolesEntity: Entity = 2 as Entity
  RolesComponent.create(rolesEntity, { shooters: [], hiders: [] })
  syncEntity(rolesEntity, [RolesComponent.componentId], 2)

  const disguisedEntity: Entity = 3 as Entity
  DisguisedPlayersComponent.create(disguisedEntity, { disguises: [] })
  syncEntity(disguisedEntity, [DisguisedPlayersComponent.componentId], 3)

  const leaderboardEntity: Entity = LEADERBOARD_ENTITY_ID as Entity
  GlobalLeaderboardComponent.create(leaderboardEntity, { hunters: [], props: [] })
  syncEntity(leaderboardEntity, [GlobalLeaderboardComponent.componentId], LEADERBOARD_ENTITY_ID)

  // --- Runtime state ---
  const connectedPlayers = new Set<string>()
  const readyPlayers     = new Set<string>()
  let activeHiders       = new Set<string>()
  const hiderHealth      = new Map<string, number>()
  const displayNames     = new Map<string, string>()

  function getLeaderboardDisplayName(address: string) {
    const name = displayNames.get(address) ?? ''
    const lastFour = address.slice(-4)
    if (!name) return address.slice(0, 8)
    const truncated = name.length > 10 ? `${name.slice(0, 7)}...` : name
    return `${truncated}#${lastFour}`
  }

  function syncLeaderboardComponent() {
    const comp = GlobalLeaderboardComponent.getMutable(leaderboardEntity)
    comp.hunters = leaderboardStore.getHuntersTop().map((entry) => ({
      address: entry.address,
      displayName: entry.displayName,
      value: entry.value
    }))
    comp.props = leaderboardStore.getPropsTop().map((entry) => ({
      address: entry.address,
      displayName: entry.displayName,
      value: entry.value
    }))
  }

  function commitWinningTeamToLeaderboard(winner: 'shooters' | 'hiders') {
    const roles = RolesComponent.get(rolesEntity)
    const winners = winner === 'shooters' ? roles.shooters : roles.hiders
    const type = winner === 'shooters' ? 'hunters' : 'props'
    let changed = false

    for (const address of winners) {
      const nextValue = leaderboardStore.getCurrentValue(type, address) + 1
      changed = leaderboardStore.update(type, address, getLeaderboardDisplayName(address), nextValue) || changed
    }

    if (changed) {
      syncLeaderboardComponent()
      void leaderboardStore.persist()
    }
  }

  function getLobbyPlayerAddresses() {
    return [...readyPlayers]
  }

  function broadcastLobbyState() {
    const phase = GameStateComponent.get(gameEntity).phase
    const readyCount = readyPlayers.size
    room.send('lobbyState', {
      connectedCount: connectedPlayers.size,
      readyCount,
      canStart: phase === 'lobby' && readyCount >= MIN_PLAYERS && readyCount <= MAX_PLAYERS,
    })
  }

  // --- Single-slot timer ---
  let timerSecondsLeft = 0
  let timerOnTick: ((s: number) => void) | null = null
  let timerOnExpire: (() => void) | null = null
  let timerTickAccum = 0

  function startTimer(seconds: number, onTick: (s: number) => void, onExpire: () => void) {
    timerSecondsLeft = seconds
    timerOnTick      = onTick
    timerOnExpire    = onExpire
    timerTickAccum   = 0
    onTick(seconds)
  }

  function cancelTimer() {
    timerOnTick    = null
    timerOnExpire  = null
    timerSecondsLeft = 0
    timerTickAccum   = 0
  }

  engine.addSystem((dt: number) => {
    if (!timerOnExpire) return
    timerSecondsLeft -= dt
    timerTickAccum   += dt
    if (timerTickAccum >= 1) {
      timerTickAccum -= 1
      timerOnTick?.(Math.max(1, Math.ceil(timerSecondsLeft)))
    }
    if (timerSecondsLeft <= 0) {
      const expire  = timerOnExpire
      cancelTimer()
      expire()
    }
  })

  // --- Phase transitions ---
  function startCinematicPhase() {
    const roles = assignRoles(getLobbyPlayerAddresses())
    RolesComponent.createOrReplace(rolesEntity, roles)
    DisguisedPlayersComponent.createOrReplace(disguisedEntity, { disguises: [] })
    GameStateComponent.createOrReplace(gameEntity, { phase: 'cinematic' })

    room.send('rolesAssigned', roles)
    room.send('gamePhaseChanged', { phase: 'cinematic' })
    console.log(`[Server] Cinematic phase — shooters: ${roles.shooters}, hiders: ${roles.hiders}`)

    startTimer(CINEMATIC_DURATION_S, (_) => {}, startHidingPhase)
  }

  function startHidingPhase() {
    GameStateComponent.createOrReplace(gameEntity, { phase: 'hiding' })
    room.send('gamePhaseChanged', { phase: 'hiding' })
    room.send('propsSpawned', { seed: Math.floor(Math.random() * 1e6) })
    console.log('[Server] Hiding phase started')

    startTimer(
      HIDING_DURATION_S,
      (s) => room.send('hideCountdown', { seconds: s }),
      startPlayingPhase,
    )
  }

  function startPlayingPhase() {
    const roles = RolesComponent.get(rolesEntity)
    activeHiders = new Set(roles.hiders)
    hiderHealth.clear()
    for (const h of roles.hiders) hiderHealth.set(h, 10)
    GameStateComponent.createOrReplace(gameEntity, { phase: 'playing' })
    room.send('gamePhaseChanged', { phase: 'playing' })
    console.log(`[Server] Playing phase — ${activeHiders.size} hiders`)

    startTimer(
      PLAYING_DURATION_S,
      (s) => room.send('playingTimer', { secondsLeft: s, hidersLeft: activeHiders.size }),
      () => endGame('hiders'),  // time ran out → hiders survived
    )
  }

  function endGame(winner: 'shooters' | 'hiders') {
    cancelTimer()
    commitWinningTeamToLeaderboard(winner)
    GameStateComponent.createOrReplace(gameEntity, { phase: 'results' })
    room.send('gamePhaseChanged', { phase: 'results' })
    room.send('gameResults', { winner })
    console.log(`[Server] Game over — ${winner} win`)

    startTimer(
      RESULTS_DURATION_S,
      (_) => {},
      resetToLobby,
    )
  }

  function resetToLobby() {
    activeHiders = new Set()
    hiderHealth.clear()
    RolesComponent.createOrReplace(rolesEntity, { shooters: [], hiders: [] })
    DisguisedPlayersComponent.createOrReplace(disguisedEntity, { disguises: [] })
    GameStateComponent.createOrReplace(gameEntity, { phase: 'lobby' })
    room.send('gamePhaseChanged', { phase: 'lobby' })
    broadcastLobbyState()
    console.log('[Server] Lobby reset')
  }

  // --- Player tracking ---
  engine.addSystem(() => {
    const current = new Set<string>()
    for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
      const addr = identity.address.toLowerCase()
      current.add(addr)
      if (identity.name) displayNames.set(addr, identity.name)
    }

    // Joins
    for (const addr of current) {
      if (!connectedPlayers.has(addr)) {
        connectedPlayers.add(addr)
        console.log(`[Server] Player joined: ${addr} (${connectedPlayers.size} total)`)
        broadcastLobbyState()
        syncLeaderboardComponent()
      }
    }

    // Disconnects
    for (const addr of connectedPlayers) {
      if (!current.has(addr)) {
        connectedPlayers.delete(addr)
        readyPlayers.delete(addr)
        console.log(`[Server] Player left: ${addr}`)
        onPlayerLeft(addr)
        broadcastLobbyState()
      }
    }

  })

  function onPlayerLeft(address: string) {
    const phase = GameStateComponent.get(gameEntity).phase

    // Remove disguise
    const disguiseState = DisguisedPlayersComponent.getMutable(disguisedEntity)
    const before = disguiseState.disguises.length
    disguiseState.disguises = disguiseState.disguises.filter(d => d.address !== address)
    if (disguiseState.disguises.length !== before) {
      room.send('playerUndisguised', { address })
    }

    // During playing: remove from active hiders
    if (phase === 'playing' && activeHiders.has(address)) {
      activeHiders.delete(address)
      if (activeHiders.size === 0) {
        endGame('shooters')
        return
      }
    }

    // Drop below min players mid-game → reset
    if (phase !== 'lobby' && phase !== 'results' && readyPlayers.size < MIN_PLAYERS) {
      cancelTimer()
      resetToLobby()
    }
  }

  // --- Client message handlers ---

  room.onMessage('selectProp', (data, context) => {
    if (!context) return
    const address = context.from.toLowerCase()
    const phase   = GameStateComponent.get(gameEntity).phase
    if (phase !== 'hiding' && phase !== 'playing') return

    const roles = RolesComponent.get(rolesEntity)
    if (!roles.hiders.includes(address)) return
    if (!VALID_PROP_SRCS.has(data.propSrc)) return

    const state    = DisguisedPlayersComponent.getMutable(disguisedEntity)
    const existing = state.disguises.findIndex(d => d.address === address)
    if (existing >= 0) {
      state.disguises[existing] = { address, propSrc: data.propSrc }
    } else {
      state.disguises.push({ address, propSrc: data.propSrc })
    }
    room.send('playerDisguised', { address, propSrc: data.propSrc })
  })

  room.onMessage('undisguise', (_, context) => {
    if (!context) return
    const address = context.from.toLowerCase()
    const state   = DisguisedPlayersComponent.getMutable(disguisedEntity)
    const before  = state.disguises.length
    state.disguises = state.disguises.filter(d => d.address !== address)
    if (state.disguises.length !== before) {
      room.send('playerUndisguised', { address })
    }
  })

  room.onMessage('aimUpdate', (data, context) => {
    if (!context) return
    const addr  = context.from.toLowerCase()
    const roles = RolesComponent.get(rolesEntity)
    if (!roles.shooters.includes(addr)) return
    room.send('shooterAim', { shooterAddress: addr, rx: data.rx, ry: data.ry, rz: data.rz, rw: data.rw })
  })

  room.onMessage('fireShot', (data, context) => {
    if (!context) return
    const addr  = context.from.toLowerCase()
    const roles = RolesComponent.get(rolesEntity)
    if (!roles.shooters.includes(addr)) return
    room.send('shotFired', { shooterAddress: addr, px: data.px, py: data.py, pz: data.pz, rx: data.rx, ry: data.ry, rz: data.rz, rw: data.rw })
  })

  room.onMessage('shoot', (data, context) => {
    if (!context) return
    const shooterAddr = context.from.toLowerCase()
    const targetAddr  = data.targetAddress.toLowerCase()
    const phase       = GameStateComponent.get(gameEntity).phase
    if (phase !== 'playing') return

    const roles = RolesComponent.get(rolesEntity)
    if (!roles.shooters.includes(shooterAddr)) return
    if (!activeHiders.has(targetAddr)) return

    const hp = (hiderHealth.get(targetAddr) ?? 1) - 1
    hiderHealth.set(targetAddr, hp)

    if (hp > 0) {
      room.send('playerHit', { address: targetAddr, health: hp })
      console.log(`[Server] ${shooterAddr} hit ${targetAddr} (${hp} HP left)`)
    } else {
      hiderHealth.delete(targetAddr)
      activeHiders.delete(targetAddr)
      room.send('playerEliminated', { address: targetAddr })
      console.log(`[Server] ${shooterAddr} eliminated ${targetAddr} (${activeHiders.size} hiders left)`)
      if (activeHiders.size === 0) endGame('shooters')
    }
  })

  room.onMessage('playerReady', (_, context) => {
    if (!context) return
    const address = context.from.toLowerCase()
    if (!connectedPlayers.has(address)) return
    readyPlayers.add(address)
    console.log(`[Server] playerReady from ${context.from}`)
    broadcastLobbyState()
  })

  room.onMessage('startGame', (_, context) => {
    if (!context) return
    const phase = GameStateComponent.get(gameEntity).phase
    if (phase !== 'lobby') return
    if (readyPlayers.size < MIN_PLAYERS || readyPlayers.size > MAX_PLAYERS) return
    console.log(`[Server] Game started by ${context.from}`)
    startCinematicPhase()
  })

  void leaderboardStore.load().then(() => {
    syncLeaderboardComponent()
  })
}
