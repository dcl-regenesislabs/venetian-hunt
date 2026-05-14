import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const room = registerMessages({
  // Client → Server
  selectProp:      Schemas.Map({ propSrc: Schemas.String }),
  undisguise:      Schemas.Map({}),
  playerReady:     Schemas.Map({}),
  startGame:       Schemas.Map({}),
  shoot:           Schemas.Map({ targetAddress: Schemas.String }),
  fireShot:        Schemas.Map({ px: Schemas.Number, py: Schemas.Number, pz: Schemas.Number, rx: Schemas.Number, ry: Schemas.Number, rz: Schemas.Number, rw: Schemas.Number }),
  aimUpdate:       Schemas.Map({ rx: Schemas.Number, ry: Schemas.Number, rz: Schemas.Number, rw: Schemas.Number }),

  // Server → Client: roles & disguises
  rolesAssigned:     Schemas.Map({ shooters: Schemas.Array(Schemas.String), hiders: Schemas.Array(Schemas.String) }),
  playerDisguised:   Schemas.Map({ address: Schemas.String, propSrc: Schemas.String }),
  playerUndisguised: Schemas.Map({ address: Schemas.String }),
  playerHit:         Schemas.Map({ address: Schemas.String, health: Schemas.Number }),
  playerEliminated:  Schemas.Map({ address: Schemas.String }),

  // Server → Client: shooting
  shotFired:  Schemas.Map({ shooterAddress: Schemas.String, px: Schemas.Number, py: Schemas.Number, pz: Schemas.Number, rx: Schemas.Number, ry: Schemas.Number, rz: Schemas.Number, rw: Schemas.Number }),
  shooterAim: Schemas.Map({ shooterAddress: Schemas.String, rx: Schemas.Number, ry: Schemas.Number, rz: Schemas.Number, rw: Schemas.Number }),

  // Server → Client: game phases & timers
  gamePhaseChanged: Schemas.Map({ phase: Schemas.String }),  // 'lobby' | 'hiding' | 'playing' | 'results'
  propsSpawned:     Schemas.Map({ seed: Schemas.Number }),
  hideCountdown:    Schemas.Map({ seconds: Schemas.Number }),
  playingTimer:     Schemas.Map({ secondsLeft: Schemas.Number, hidersLeft: Schemas.Number }),
  gameResults:      Schemas.Map({ winner: Schemas.String }),  // 'shooters' | 'hiders'
  stateSync:        Schemas.Map({
    phase:      Schemas.String,
    shooters:   Schemas.Array(Schemas.String),
    hiders:     Schemas.Array(Schemas.String),
    disguises:  Schemas.Array(Schemas.Map({ address: Schemas.String, propSrc: Schemas.String })),
    secondsLeft: Schemas.Number,
    hidersLeft:  Schemas.Number,
    winner:      Schemas.String,
    propSeed:    Schemas.Number,
    healths:     Schemas.Array(Schemas.Map({ address: Schemas.String, health: Schemas.Number })),
  }),
})
