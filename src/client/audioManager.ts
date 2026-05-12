import { engine, AudioSource, Transform, Entity } from '@dcl/sdk/ecs'

const GUNSHOT_SRC = 'assets/sounds/gunshot.mp3'

type AudioEntry = { entity: Entity; ttl: number }
const pending: AudioEntry[] = []

export function playGunshotAt(x: number, y: number, z: number) {
  const entity = engine.addEntity()
  Transform.create(entity, { position: { x, y, z } })
  AudioSource.create(entity, {
    audioClipUrl: GUNSHOT_SRC,
    loop: false,
    playing: true,
    volume: 1.0,
  })
  pending.push({ entity, ttl: 2.0 })
}

engine.addSystem((dt: number) => {
  for (let i = pending.length - 1; i >= 0; i--) {
    pending[i].ttl -= dt
    if (pending[i].ttl <= 0) {
      engine.removeEntity(pending[i].entity)
      pending.splice(i, 1)
    }
  }
})
