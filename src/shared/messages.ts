import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const room = registerMessages({
  // Client → Server
  selectProp:        Schemas.Map({ propSrc: Schemas.String }),
  undisguise:        Schemas.Map({}),
  playerReady:       Schemas.Map({}),
  debugSwitchRole:   Schemas.Map({}),
  shoot:    Schemas.Map({ targetAddress: Schemas.String }),
  fireShot:  Schemas.Map({ px: Schemas.Number, py: Schemas.Number, pz: Schemas.Number, rx: Schemas.Number, ry: Schemas.Number, rz: Schemas.Number, rw: Schemas.Number }),
  aimUpdate: Schemas.Map({ rx: Schemas.Number, ry: Schemas.Number, rz: Schemas.Number, rw: Schemas.Number }),
  playerEliminated: Schemas.Map({ address: Schemas.String }),

  // Server → Client
  shotFired:  Schemas.Map({ shooterAddress: Schemas.String, px: Schemas.Number, py: Schemas.Number, pz: Schemas.Number, rx: Schemas.Number, ry: Schemas.Number, rz: Schemas.Number, rw: Schemas.Number }),
  shooterAim: Schemas.Map({ shooterAddress: Schemas.String, rx: Schemas.Number, ry: Schemas.Number, rz: Schemas.Number, rw: Schemas.Number }),

  // Server → Client
  rolesAssigned: Schemas.Map({
    shooters: Schemas.Array(Schemas.String),
    hiders:   Schemas.Array(Schemas.String),
  }),
  playerDisguised: Schemas.Map({
    address: Schemas.String,
    propSrc: Schemas.String,
  }),
  playerUndisguised: Schemas.Map({
    address: Schemas.String,
  }),
  gamePhaseChanged: Schemas.Map({
    phase: Schemas.String,  // 'lobby' | 'playing' | 'results'
  }),
})
