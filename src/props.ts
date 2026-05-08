import { engine, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { PROP_SPAWN_POINTS } from './propSpawnPoints'

export function spawnProps() {
  for (const [src, transforms] of Object.entries(PROP_SPAWN_POINTS)) {
    for (const t of transforms) {
      const entity = engine.addEntity()
      GltfContainer.create(entity, { src })
      Transform.create(entity, {
        position: t.position,
        rotation: t.rotation,
        scale: t.scale
      })
    }
  }
}
