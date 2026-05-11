import { engine, Entity, Billboard, BillboardMode, MeshRenderer, Material, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'

const BAR_WIDTH     = 1.2
const BAR_HEIGHT    = 0.14
const BAR_DEPTH     = 0.05
const BAR_Y_OFFSET  = 2.5
const SHOW_DURATION = 2.5
const MAX_HP        = 10

type BarData = { root: Entity; bg: Entity; fill: Entity; timer: number }
const bars = new Map<string, BarData>()

function hpColor(hp: number): Color4 {
  if (hp >= 8) return Color4.create(0.15, 0.9, 0.2, 1)
  if (hp >= 4) return Color4.create(1, 0.85, 0, 1)
  return Color4.create(0.95, 0.15, 0.15, 1)
}

function setBarVisible(bar: BarData, visible: boolean) {
  VisibilityComponent.createOrReplace(bar.bg,   { visible })
  VisibilityComponent.createOrReplace(bar.fill, { visible })
}

export function createHealthBar(address: string, parentEntity: Entity) {
  const addr = address.toLowerCase()
  if (bars.has(addr)) return

  const root = engine.addEntity()
  Billboard.create(root, { billboardMode: BillboardMode.BM_ALL })
  Transform.create(root, {
    parent: parentEntity,
    position: { x: 0, y: BAR_Y_OFFSET, z: 0 },
  })

  const bg = engine.addEntity()
  MeshRenderer.setBox(bg)
  Material.setPbrMaterial(bg, { albedoColor: Color4.create(0.08, 0.08, 0.08, 0.9) })
  Transform.create(bg, {
    parent: root,
    position: { x: 0, y: 0, z: 0 },
    scale: { x: BAR_WIDTH, y: BAR_HEIGHT, z: BAR_DEPTH },
  })
  VisibilityComponent.create(bg, { visible: false })

  const fill = engine.addEntity()
  MeshRenderer.setBox(fill)
  Material.setPbrMaterial(fill, { albedoColor: hpColor(MAX_HP) })
  Transform.create(fill, {
    parent: root,
    position: { x: 0, y: 0, z: -0.01 },
    scale: { x: BAR_WIDTH, y: BAR_HEIGHT, z: BAR_DEPTH },
  })
  VisibilityComponent.create(fill, { visible: false })

  bars.set(addr, { root, bg, fill, timer: 0 })
}

export function removeHealthBar(address: string) {
  bars.delete(address.toLowerCase())
}

export function clearAllHealthBars() {
  bars.clear()
}

export function onHiderHit(address: string, health: number) {
  const bar = bars.get(address.toLowerCase())
  if (!bar) return

  const ratio   = health / MAX_HP
  const fillT   = Transform.getMutable(bar.fill)
  fillT.scale.x    = Math.max(0, BAR_WIDTH * ratio)
  fillT.position.x = -BAR_WIDTH / 2 + fillT.scale.x / 2

  Material.setPbrMaterial(bar.fill, { albedoColor: hpColor(health) })

  setBarVisible(bar, true)
  bar.timer = SHOW_DURATION
}

engine.addSystem((dt: number) => {
  for (const [, bar] of bars) {
    if (bar.timer <= 0) continue
    bar.timer -= dt
    if (bar.timer <= 0) {
      setBarVisible(bar, false)
    }
  }
})
