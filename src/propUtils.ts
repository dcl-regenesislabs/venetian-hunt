import { engine, Entity, GltfContainer, MeshRenderer, MeshCollider, ColliderLayer } from '@dcl/sdk/ecs'

export const PRIMITIVE_CUBE     = 'primitive://cube'
export const PRIMITIVE_CYLINDER = 'primitive://cylinder'

export function isPrimitive(src: string) {
  return src === PRIMITIVE_CUBE || src === PRIMITIVE_CYLINDER
}

// Apply the visual + collider components to an entity.
// disguise=true → no collision (prop follows a player); false → normal scene collision
export function applyPropComponents(entity: Entity, src: string, disguise: boolean) {
  if (src === PRIMITIVE_CUBE) {
    MeshRenderer.setBox(entity)
    if (!disguise) MeshCollider.setBox(entity)
  } else if (src === PRIMITIVE_CYLINDER) {
    MeshRenderer.setCylinder(entity, 0.5, 0.5)
    if (!disguise) MeshCollider.setCylinder(entity, 0.5, 0.5)
  } else {
    GltfContainer.create(entity, {
      src,
      invisibleMeshesCollisionMask: disguise ? ColliderLayer.CL_NONE : undefined as any,
      visibleMeshesCollisionMask:   disguise ? ColliderLayer.CL_NONE : undefined as any,
    })
  }
}

// Scale and y-offset for primitive disguise props attached to the player.
// Must match the scene decorative scale (1,1,1) so they look identical.
// MeshRenderer primitives are centered at their origin, so y=0.5 puts the bottom at the player's feet.
export function primitiveDisguiseTransform(src: string) {
  if (src === PRIMITIVE_CUBE)     return { scale: { x: 1, y: 1, z: 1 }, y: 0.46 }
  if (src === PRIMITIVE_CYLINDER) return { scale: { x: 1, y: 1, z: 1 }, y: 0.46 }
  return null
}
