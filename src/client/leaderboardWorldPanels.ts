import {
  engine,
  Entity,
  Material,
  MeshRenderer,
  TextAlignMode,
  TextShape,
  Transform
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { GlobalLeaderboardComponent } from '../shared/schemas'

type EntryRow = {
  name: Entity
  value: Entity
}

type LeaderboardEntryData = {
  address: string
  displayName: string
  value: number
}

type Panel = {
  title: Entity
  rows: EntryRow[]
}

type LeaderboardSnapshot = {
  hunters: LeaderboardEntryData[]
  props: LeaderboardEntryData[]
}

const STICK_POSITION = Vector3.create(16.75, 2.5, 6.5)
const STICK_ROTATION = Quaternion.fromEulerDegrees(0, 270, 0)
const ROOT_SCALE = Vector3.One()
const PANEL_BG = Color4.fromHexString('#0b0b0be8')
const HEADER_BG = Color4.fromHexString('#1c1c1cff')
const HUNTER_ACCENT = Color4.fromHexString('#b12a2aff')
const PROP_ACCENT = Color4.fromHexString('#2a8f42ff')
const HEADER_TEXT = Color4.fromHexString('#f2d35cff')
const ROW_TEXT = Color4.White()
const VALUE_TEXT = Color4.fromHexString('#f5f5f5ff')
const ROWS = 10
let latestSnapshot: LeaderboardSnapshot = { hunters: [], props: [] }

function truncateName(displayName: string, address: string, maxLen = 12) {
  const base = displayName && displayName.length > 0 ? displayName : address.slice(0, 8)
  return base.length > maxLen ? `${base.slice(0, maxLen - 1)}…` : base
}

function createText(parent: Entity, position: Vector3, text: string, fontSize: number, textAlign: TextAlignMode, color: Color4) {
  const entity = engine.addEntity()
  Transform.create(entity, {
    parent,
    position,
    rotation: Quaternion.Identity(),
    scale: Vector3.One()
  })
  TextShape.create(entity, {
    text,
    fontSize,
    textAlign,
    textColor: color,
    outlineColor: Color4.Black(),
    outlineWidth: 0.12
  })
  return entity
}

function createPanel(parent: Entity, title: string, accent: Color4, offset: Vector3): Panel {
  const root = engine.addEntity()
  Transform.create(root, {
    parent,
    position: offset,
    rotation: Quaternion.Identity(),
    scale: Vector3.One()
  })

  const bg = engine.addEntity()
  Transform.create(bg, {
    parent: root,
    position: Vector3.Zero(),
    rotation: Quaternion.Identity(),
    scale: Vector3.create(2.4, 3.5, 1)
  })
  MeshRenderer.setPlane(bg)
  Material.setBasicMaterial(bg, { diffuseColor: PANEL_BG })

  const header = engine.addEntity()
  Transform.create(header, {
    parent: root,
    position: Vector3.create(0, 1.65, -0.01),
    rotation: Quaternion.Identity(),
    scale: Vector3.create(2.4, 0.45, 1)
  })
  MeshRenderer.setPlane(header)
  Material.setBasicMaterial(header, { diffuseColor: HEADER_BG })

  const accentBar = engine.addEntity()
  Transform.create(accentBar, {
    parent: root,
    position: Vector3.create(0, 1.42, -0.02),
    rotation: Quaternion.Identity(),
    scale: Vector3.create(2.2, 0.03, 1)
  })
  MeshRenderer.setPlane(accentBar)
  Material.setBasicMaterial(accentBar, { diffuseColor: accent })

  const titleEntity = createText(root, Vector3.create(0, 1.5, -0.03), title, 1.0, TextAlignMode.TAM_MIDDLE_CENTER, HEADER_TEXT)
  createText(root, Vector3.create(-0.75, 1.2, -0.03), 'PLAYER', 1.08, TextAlignMode.TAM_MIDDLE_LEFT, accent)
  createText(root, Vector3.create(0.88, 1.2, -0.03), 'WINS', 1.08, TextAlignMode.TAM_MIDDLE_RIGHT, accent)

  const rows: EntryRow[] = []
  for (let i = 0; i < ROWS; i++) {
    const y = 0.92 - i * 0.27
    createText(root, Vector3.create(-1.02, y, -0.03), `${i + 1}.`, 0.92, TextAlignMode.TAM_MIDDLE_LEFT, Color4.fromHexString('#bdbdbdff'))
    const name = createText(root, Vector3.create(-0.74, y, -0.03), i === 0 ? 'No data yet' : '', 1.08, TextAlignMode.TAM_MIDDLE_LEFT, ROW_TEXT)
    const value = createText(root, Vector3.create(0.88, y, -0.03), '', 1.08, TextAlignMode.TAM_MIDDLE_RIGHT, VALUE_TEXT)
    rows.push({ name, value })
  }

  return { title: titleEntity, rows }
}

function updatePanel(panel: Panel, entries: ReadonlyArray<LeaderboardEntryData>) {
  for (let i = 0; i < panel.rows.length; i++) {
    const row = panel.rows[i]
    const entry = entries[i]
    TextShape.getMutable(row.name).text = entry ? truncateName(entry.displayName, entry.address) : i === 0 ? 'No data yet' : ''
    TextShape.getMutable(row.value).text = entry ? String(entry.value) : ''
  }
}

export function initLeaderboardWorldPanels() {
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(STICK_POSITION.x, STICK_POSITION.y + 2.0, STICK_POSITION.z),
    rotation: STICK_ROTATION,
    scale: ROOT_SCALE
  })

  const huntersPanel = createPanel(root, 'HUNTERS', HUNTER_ACCENT, Vector3.create(-1.4, 0, 0))
  const propsPanel = createPanel(root, 'PROPS', PROP_ACCENT, Vector3.create(1.4, 0, 0))

  let lastHuntersKey = ''
  let lastPropsKey = ''
  let accumulator = 0

  engine.addSystem((dt: number) => {
    accumulator += dt
    if (accumulator < 0.5) return
    accumulator = 0

    if (latestSnapshot.hunters.length === 0 && latestSnapshot.props.length === 0) {
      for (const [, comp] of engine.getEntitiesWith(GlobalLeaderboardComponent)) {
        latestSnapshot = {
          hunters: comp.hunters.map((entry) => ({ address: entry.address, displayName: entry.displayName, value: entry.value })),
          props: comp.props.map((entry) => ({ address: entry.address, displayName: entry.displayName, value: entry.value }))
        }
        break
      }
    }

    const huntersKey = latestSnapshot.hunters.map((entry: LeaderboardEntryData) => `${entry.address}:${entry.value}`).join('|')
    if (huntersKey !== lastHuntersKey) {
      lastHuntersKey = huntersKey
      updatePanel(huntersPanel, latestSnapshot.hunters)
    }

    const propsKey = latestSnapshot.props.map((entry: LeaderboardEntryData) => `${entry.address}:${entry.value}`).join('|')
    if (propsKey !== lastPropsKey) {
      lastPropsKey = propsKey
      updatePanel(propsPanel, latestSnapshot.props)
    }
  }, undefined, 'leaderboard-world-panels-system')
}

export function setLeaderboardSnapshot(snapshot: LeaderboardSnapshot) {
  latestSnapshot = {
    hunters: snapshot.hunters.map((entry) => ({ ...entry })),
    props: snapshot.props.map((entry) => ({ ...entry }))
  }
}
