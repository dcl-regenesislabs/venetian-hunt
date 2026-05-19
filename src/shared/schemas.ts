import { engine, Schemas } from '@dcl/sdk/ecs'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

export const GameStateComponent = engine.defineComponent('prophunt:GameState', {
  phase:       Schemas.String,   // 'lobby' | 'playing' | 'results'
  playerCount: Schemas.Number,
})

export const RolesComponent = engine.defineComponent('prophunt:Roles', {
  shooters: Schemas.Array(Schemas.String),
  hiders:   Schemas.Array(Schemas.String),
})

export const DisguisedPlayersComponent = engine.defineComponent('prophunt:DisguisedPlayers', {
  disguises: Schemas.Array(Schemas.Map({
    address: Schemas.String,
    propSrc:  Schemas.String,
  })),
})

GameStateComponent.validateBeforeChange(      (v) => v.senderAddress === AUTH_SERVER_PEER_ID)
RolesComponent.validateBeforeChange(          (v) => v.senderAddress === AUTH_SERVER_PEER_ID)
DisguisedPlayersComponent.validateBeforeChange((v) => v.senderAddress === AUTH_SERVER_PEER_ID)
