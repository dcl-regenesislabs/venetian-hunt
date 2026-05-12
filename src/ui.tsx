import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from '@dcl/sdk/react-ecs'
import {
  engine,
  inputSystem, InputAction, PointerEventType,
  GltfContainer, ColliderLayer, Transform, VisibilityComponent,
  PlayerIdentityData, CameraModeArea, CameraType,
  Entity
} from '@dcl/sdk/ecs'
import { applyPropComponents, primitiveDisguiseTransform, PRIMITIVE_CYLINDER } from './propUtils'
import { blinkEntity, stopBlinkingEntity } from './client/propSystem'
import { getUserData } from '~system/UserIdentity'
import { room } from './shared/messages'
import { addVisiblePlayer, removeVisiblePlayer } from './avatarHiding'
import { Color4, Quaternion } from '@dcl/sdk/math'
import { activateShooter, deactivateShooter, getLastShotMs, setWeaponEntity } from './client/shooterSystem'
import { uiState } from './client/setup'

const WEAPON_SRC = 'assets/scene/Models/low-poly_agm-1.glb'

const PROPS = [
  { name: 'Chair',          thumbnail: 'assets/images/props/chair.png',        src: 'assets/asset-packs/outdoor_chair/Chair_07.glb' },
  { name: 'Blue Bicycle',   thumbnail: 'assets/images/props/bicycle.png',      src: 'assets/asset-packs/blue_bicycle/Bicycle_02/Bicycle_02.glb' },
  { name: 'Red Bicycle',    thumbnail: 'assets/images/props/bicycle.png',      src: 'assets/asset-packs/red_bicycle/Bicycle_01/Bicycle_01.glb' },
  { name: 'Lamp Post',      thumbnail: 'assets/images/props/lamppost.png',     src: 'assets/asset-packs/traditional_lamp_post/LampPost_02/LampPost_02.glb' },
  { name: 'Clay Pot',       thumbnail: 'assets/images/props/pot.png',          src: 'assets/asset-packs/clay_pot/Pot_01/Pot_01.glb' },
  { name: 'Bird Fountain',  thumbnail: 'assets/images/props/birdfountain.png', src: 'assets/asset-packs/bird_fountain/BirdFountain_01/BirdFountain_01.glb' },
  { name: 'Umbrella Table', thumbnail: 'assets/images/props/table.png',        src: 'assets/asset-packs/umbrella_table/TableBar_01/TableBar_01.glb' },
  { name: 'Fern Pot',       thumbnail: 'assets/images/props/fernpot.png',      src: 'assets/asset-packs/planted_fern/PlantPot_03/PlantPot_03.glb' },
  { name: 'Cylinder',       thumbnail: '',                                      src: PRIMITIVE_CYLINDER },
  { name: 'Cardboard Box',  thumbnail: '',                                      src: 'assets/asset-packs/square_cardboard_box/CardboardBox_02/CardboardBox_02.glb' },
  { name: 'Avatar',         thumbnail: '',                                      src: '' },
]

let selectedIndex    = 0
let propEntity:      Entity | undefined
let weaponEntity:    Entity | undefined
let camAreaEntity:   Entity | undefined
let cinematicWeapon: Entity | undefined
let playerRole: 'hider' | 'shooter' = 'hider' 

// ── Debug mode ────────────────────────────────────────────────────
// Set DEBUG = true to preview UI panels in-world without playing.
// Key 1 (IA_ACTION_3): cycle phase   Key 2 (IA_ACTION_4): toggle role
export const DEBUG = false
const DEBUG_PHASES = ['lobby', 'cinematic', 'hiding', 'playing', 'results'] as const
let dbgPhaseIdx = 1   // start at 'cinematic'
let dbgRole: 'hider' | 'shooter' = 'hider'

export function blinkLocalProp() {
  if (propEntity !== undefined) blinkEntity(propEntity)
}

export function getCurrentPropSrc(): string {
  return PROPS[selectedIndex].src
}

function attachProp(src: string) {
  if (propEntity !== undefined) {
    stopBlinkingEntity(propEntity)
    engine.removeEntity(propEntity)
    propEntity = undefined
  }
  const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
  if (src === '') {
    room.send('undisguise', {})
    if (myAddress) addVisiblePlayer(myAddress)
    return
  }
  if (myAddress) removeVisiblePlayer(myAddress)
  room.send('selectProp', { propSrc: src })
  propEntity = engine.addEntity()
  applyPropComponents(propEntity, src, true)
  const prim = primitiveDisguiseTransform(src)
  Transform.create(propEntity, {
    parent: engine.PlayerEntity,
    position: { x: 0, y: prim ? prim.y : -0.1, z: 0 },
    scale:    prim ? prim.scale : { x: 1, y: 1, z: 1 },
  })
  VisibilityComponent.createOrReplace(propEntity, { visible: true })
}

export function reattachProp() {
  attachProp(PROPS[selectedIndex].src)
}

export function setPlayerRole(role: 'hider' | 'shooter', skipProp = false) {
  playerRole = role

  if (role === 'shooter') {
    if (propEntity !== undefined) {
      engine.removeEntity(propEntity)
      propEntity = undefined
    }
    if (weaponEntity === undefined) {
      weaponEntity = engine.addEntity()
      GltfContainer.create(weaponEntity, {
        src: WEAPON_SRC,
        invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
        visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      })
      Transform.create(weaponEntity, {
        parent: engine.CameraEntity,
        position: { x: 0.4, y: -0.3, z: 0.7 },
        rotation: Quaternion.fromEulerDegrees(0, 90, 0),
        scale: { x: 0.02, y: 0.02, z: 0.02 },
      })
      setWeaponEntity(weaponEntity)
    }
    camAreaEntity = engine.addEntity()
    Transform.create(camAreaEntity, { parent: engine.PlayerEntity, position: { x: 0, y: 0, z: 0 } })
    CameraModeArea.create(camAreaEntity, { area: { x: 0.5, y: 2, z: 0.5 }, mode: CameraType.CT_FIRST_PERSON })
    activateShooter()
  } else {
    if (weaponEntity !== undefined) {
      engine.removeEntity(weaponEntity)
      weaponEntity = undefined
      setWeaponEntity(undefined)
    }
    if (camAreaEntity !== undefined) {
      engine.removeEntity(camAreaEntity)
      camAreaEntity = undefined
    }
    deactivateShooter()
    if (!skipProp) attachProp(PROPS[selectedIndex].src)
  }
}

export function clearLocalProp() {
  if (propEntity !== undefined) {
    stopBlinkingEntity(propEntity)
    engine.removeEntity(propEntity)
    propEntity = undefined
  }
  const myAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
  if (myAddress) addVisiblePlayer(myAddress)
}

export function createCinematicWeapon() {
  if (playerRole !== 'shooter' || cinematicWeapon !== undefined) return
  cinematicWeapon = engine.addEntity()
  GltfContainer.create(cinematicWeapon, {
    src: WEAPON_SRC,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
  })
  Transform.create(cinematicWeapon, {
    parent: engine.PlayerEntity,
    position: { x: 0.4, y: 0.9, z: 0.1 },
    rotation: Quaternion.fromEulerDegrees(0, -90, 0),
    scale: { x: 0.02, y: 0.02, z: 0.02 },
  })
}

export function removeCinematicWeapon() {
  if (cinematicWeapon !== undefined) {
    engine.removeEntity(cinematicWeapon)
    cinematicWeapon = undefined
  }
}

export function resetForLobby() {
  clearLocalProp()
  deactivateShooter()
  if (weaponEntity !== undefined) {
    engine.removeEntity(weaponEntity)
    weaponEntity = undefined
    setWeaponEntity(undefined)
  }
  if (camAreaEntity !== undefined) {
    engine.removeEntity(camAreaEntity)
    camAreaEntity = undefined
  }
  playerRole    = 'hider'
  selectedIndex = 0
}

export function setupUi() {
  getUserData({}).then(({ data }) => {
    const body = data?.avatar?.snapshots?.body
    if (body) PROPS[PROPS.length - 1].thumbnail = body
  }).catch(() => {})

  engine.addSystem(() => {
    if (DEBUG) {
      if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN))
        dbgPhaseIdx = (dbgPhaseIdx + 1) % DEBUG_PHASES.length
      if (inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN))
        dbgRole = dbgRole === 'hider' ? 'shooter' : 'hider'
      return
    }
    if (playerRole !== 'hider') return
    if (uiState.phase !== 'hiding' && uiState.phase !== 'playing') return
    if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) {
      selectedIndex = (selectedIndex - 1 + PROPS.length) % PROPS.length
      attachProp(PROPS[selectedIndex].src)
    }
    if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) {
      selectedIndex = (selectedIndex + 1) % PROPS.length
      attachProp(PROPS[selectedIndex].src)
    }
  })

  ReactEcsRenderer.setUiRenderer(uiMenu, { virtualWidth: 1920, virtualHeight: 1080 })
}

// --- Colors ---
const WHITE:    Color4 = { r: 1,    g: 1,    b: 1,    a: 1    }
const BLACK:    Color4 = { r: 0,    g: 0,    b: 0,    a: 1    }
const RED:      Color4 = { r: 0.9,  g: 0.2,  b: 0.2,  a: 1    }
const GREEN:    Color4 = { r: 0.2,  g: 0.85, b: 0.3,  a: 1    }
const YELLOW:   Color4 = { r: 1,    g: 0.85, b: 0,    a: 1    }
const BG_DARK:  Color4 = { r: 0,    g: 0,    b: 0,    a: 0.72 }
const BG_PANEL: Color4 = { r: 0,    g: 0,    b: 0,    a: 0.55 }

function OutlinedLabel(props: { value: string; width: number; height: number; fontSize: number; marginTop?: number; color?: Color4 }) {
  const { value, width, height, fontSize, marginTop, color } = props
  return (
    <UiEntity uiTransform={{ width, height, margin: { top: marginTop ?? 0 } }}>
      <Label value={value} uiTransform={{ width, height, positionType: 'absolute', position: { top: 2, left: 2 } }}
        textAlign="middle-center" fontSize={fontSize} color={BLACK} />
      <Label value={value} uiTransform={{ width, height, positionType: 'absolute', position: { top: 0, left: 0 } }}
        textAlign="middle-center" fontSize={fontSize} color={color ?? WHITE} />
    </UiEntity>
  )
}

const BLOOM_MS = 150

function Crosshair() {
  const blooming    = Date.now() - getLastShotMs() < BLOOM_MS
  const gap         = blooming ? 14 : 6
  const lineLength  = blooming ? 14 : 10
  const thickness   = 2
  const dot         = 2
  return (
    <UiEntity uiTransform={{ width: 100, height: 100, positionType: 'absolute', position: { top: '50%', left: '50%' }, margin: { top: -50, left: -50 } }}>
      <UiEntity uiTransform={{ width: thickness, height: lineLength, positionType: 'absolute', position: { top: '50%', left: '50%' }, margin: { top: -(gap + lineLength), left: -(thickness / 2) } }} uiBackground={{ color: WHITE }} />
      <UiEntity uiTransform={{ width: thickness, height: lineLength, positionType: 'absolute', position: { top: '50%', left: '50%' }, margin: { top: gap, left: -(thickness / 2) } }} uiBackground={{ color: WHITE }} />
      <UiEntity uiTransform={{ width: lineLength, height: thickness, positionType: 'absolute', position: { top: '50%', left: '50%' }, margin: { top: -(thickness / 2), left: -(gap + lineLength) } }} uiBackground={{ color: WHITE }} />
      <UiEntity uiTransform={{ width: lineLength, height: thickness, positionType: 'absolute', position: { top: '50%', left: '50%' }, margin: { top: -(thickness / 2), left: gap } }} uiBackground={{ color: WHITE }} />
      <UiEntity uiTransform={{ width: dot, height: dot, positionType: 'absolute', position: { top: '50%', left: '50%' }, margin: { top: -(dot / 2), left: -(dot / 2) } }} uiBackground={{ color: WHITE }} />
    </UiEntity>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function countConnectedPlayers(): number {
  let n = 0
  for (const _ of engine.getEntitiesWith(PlayerIdentityData)) n++
  return n
}

// ---- Phase panels ----

function LobbyPanel() {
  const count    = countConnectedPlayers()
  const canStart = count >= 2 && count <= 6

  const SLOT_ON:  Color4 = { r: 0.2,  g: 0.85, b: 0.3,  a: 1    }
  const SLOT_OFF: Color4 = { r: 0.2,  g: 0.2,  b: 0.2,  a: 1    }
  const ONLINE:   Color4 = { r: 0.15, g: 0.75, b: 0.3,  a: 1    }
  const BTN_DIM:  Color4 = { r: 0.18, g: 0.18, b: 0.18, a: 1    }
  const statusMsg = count < 2 ? 'Waiting for more players...' : count > 6 ? 'Too many players (max 6)' : 'Ready to start!'

  return (
    <UiEntity
      uiTransform={{
        width: 480, flexDirection: 'column', alignItems: 'center',
        positionType: 'absolute', position: { top: 32, left: '50%' },
        margin: { left: -240 },
      }}
    >
      {/* Server status bar */}
      <UiEntity
        uiTransform={{ width: 480, height: 44, flexDirection: 'row', alignItems: 'center', padding: { left: 20, right: 20 }, justifyContent: 'space-between', borderRadius: 12 }}
        uiBackground={{ color: { r: 0.08, g: 0.08, b: 0.08, a: 0.95 } }}
      >
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center' }}>
          <UiEntity uiTransform={{ width: 10, height: 10, borderRadius: 5, margin: { right: 8 } }} uiBackground={{ color: ONLINE }} />
          <OutlinedLabel value="SERVER ONLINE" width={160} height={32} fontSize={16} color={ONLINE} />
        </UiEntity>
        <OutlinedLabel value={`${count} / 6 players`} width={120} height={32} fontSize={16} color={WHITE} />
      </UiEntity>

      <UiEntity uiTransform={{ height: 8 }} />

      {/* Main card */}
      <UiEntity
        uiTransform={{ width: 480, flexDirection: 'column', alignItems: 'center', borderRadius: 16 }}
        uiBackground={{ color: { r: 0.07, g: 0.07, b: 0.07, a: 0.95 } }}
      >
        {/* Player slots */}
        <UiEntity
          uiTransform={{ width: 440, height: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', margin: { top: 20 } }}
        >
          {[0,1,2,3,4,5].map(i => (
            <UiEntity key={i}
              uiTransform={{ width: 48, height: 48, borderRadius: 24, margin: { left: 8, right: 8 }, alignItems: 'center', justifyContent: 'center' }}
              uiBackground={{ color: i < count ? SLOT_ON : SLOT_OFF }}
            >
              {i < count && (
                <Label value={`${i + 1}`} uiTransform={{ width: 48, height: 48 }} textAlign="middle-center" fontSize={18} color={BLACK} />
              )}
            </UiEntity>
          ))}
        </UiEntity>

        {/* Status message */}
        <OutlinedLabel
          value={statusMsg}
          width={440} height={28} fontSize={17} marginTop={4}
          color={canStart ? GREEN : { r: 0.6, g: 0.6, b: 0.6, a: 1 }}
        />

        {/* Start button */}
        <UiEntity
          uiTransform={{ width: 380, height: 52, alignItems: 'center', justifyContent: 'center', margin: { top: 16, bottom: 20 }, borderRadius: 12 }}
          uiBackground={{ color: canStart ? GREEN : BTN_DIM }}
          onMouseDown={() => { if (canStart) room.send('startGame', {}) }}
        >
          <Label
            value={canStart ? 'START GAME' : count < 2 ? 'Need 2+ players' : 'Max 6 players'}
            uiTransform={{ width: 380, height: 52 }}
            textAlign="middle-center"
            fontSize={24}
            color={canStart ? BLACK : { r: 0.4, g: 0.4, b: 0.4, a: 1 }}
          />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

function HidingPanelHider() {
  const prop = PROPS[selectedIndex]
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: { top: 24, bottom: 64 } }}>
      {/* Top banner */}
      <UiEntity
        uiTransform={{ width: 420, height: 72, alignItems: 'center', justifyContent: 'center' }}
        uiBackground={{ color: BG_DARK }}
      >
        <OutlinedLabel value={`HIDE!  ${uiState.hideSecondsLeft}s`} width={400} height={60} fontSize={38} color={GREEN} />
      </UiEntity>

      {/* Bottom: prop selector */}
      <UiEntity
        uiTransform={{ width: 440, height: 80, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: { left: 16, right: 16 } }}
      >
        <OutlinedLabel value="◄  E" width={72} height={72} fontSize={26} />
        <OutlinedLabel value={prop.name.toUpperCase()} width={200} height={32} fontSize={20} />
        <OutlinedLabel value="F  ►" width={72} height={72} fontSize={26} />
      </UiEntity>
    </UiEntity>
  )
}

function HidingPanelShooter() {
  return (
    <UiEntity
      uiTransform={{ width: 520, height: 88, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', positionType: 'absolute', position: { top: 24, left: '50%' }, margin: { left: -260 } }}
      uiBackground={{ color: BG_DARK }}
    >
      <OutlinedLabel value={`HUNTERS WAIT  —  ${uiState.hideSecondsLeft}s`} width={500} height={50} fontSize={32} color={RED} />
      <OutlinedLabel value="Hiders are hiding..." width={500} height={32} fontSize={20} marginTop={4} />
    </UiEntity>
  )
}

function PlayingHUD() {
  const timeStr = formatTime(uiState.playingSecondsLeft)
  const roleColor = playerRole === 'shooter' ? RED : GREEN
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center' }}>
      {playerRole === 'shooter' && <Crosshair />}

      {/* Top bar */}
      <UiEntity
        uiTransform={{ width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', margin: { top: 24 } }}
      >
        <UiEntity
          uiTransform={{ width: 480, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: { left: 20, right: 20 } }}
          uiBackground={{ color: BG_PANEL }}
        >
          <OutlinedLabel value={playerRole === 'shooter' ? 'SHOOTER' : 'HIDER'} width={200} height={44} fontSize={26} color={roleColor} />
          <OutlinedLabel value={timeStr} width={100} height={44} fontSize={30} color={YELLOW} />
          {playerRole === 'shooter' && (
            <OutlinedLabel value={`${uiState.hidersLeft} left`} width={120} height={44} fontSize={24} color={WHITE} />
          )}
          {playerRole === 'hider' && (
            <OutlinedLabel
              value={`HP ${uiState.localHealth}/10`}
              width={120} height={44} fontSize={24}
              color={uiState.localHealth >= 8 ? GREEN : uiState.localHealth >= 4 ? YELLOW : RED}
            />
          )}
        </UiEntity>
      </UiEntity>

      {/* Prop selector (hiders only) */}
      {playerRole === 'hider' && !uiState.eliminated && (
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', positionType: 'absolute', position: { bottom: 64 } }}>
          <UiEntity
            uiTransform={{ width: 440, height: 80, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: { left: 16, right: 16 } }}
          >
            <OutlinedLabel value="◄  E" width={72} height={72} fontSize={26} />
            <OutlinedLabel value={PROPS[selectedIndex].name.toUpperCase()} width={200} height={32} fontSize={20} />
            <OutlinedLabel value="F  ►" width={72} height={72} fontSize={26} />
          </UiEntity>
        </UiEntity>
      )}

      {/* Eliminated overlay */}
      {playerRole === 'hider' && uiState.eliminated && (
        <UiEntity
          uiTransform={{ width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', positionType: 'absolute', position: { top: 0, left: 0 } }}
          uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0.45 } }}
        >
          <OutlinedLabel value="ELIMINATED" width={500} height={80} fontSize={58} color={RED} />
          <OutlinedLabel value="You've been found!" width={500} height={40} fontSize={26} marginTop={8} />
        </UiEntity>
      )}
    </UiEntity>
  )
}

function CinematicPanel(props: { role?: 'hider' | 'shooter' }) {
  const isHider = (props.role ?? playerRole) === 'hider'

  const GRN_CARD: Color4 = { r: 0.05, g: 0.22, b: 0.07, a: 0.92 }
  const GRN_DIM:  Color4 = { r: 0.03, g: 0.12, b: 0.04, a: 0.80 }
  const RED_CARD: Color4 = { r: 0.22, g: 0.04, b: 0.04, a: 0.92 }
  const RED_DIM:  Color4 = { r: 0.12, g: 0.02, b: 0.02, a: 0.80 }
  const DIM_TEXT: Color4 = { r: 0.55, g: 0.55, b: 0.55, a: 1    }
  const KEY_BG:   Color4 = { r: 0,    g: 0,    b: 0,    a: 0.45 }
  const THUMB_BG: Color4 = { r: 0.15, g: 0.15, b: 0.15, a: 1    }

  const prevIdx  = (selectedIndex - 1 + PROPS.length) % PROPS.length
  const nextIdx  = (selectedIndex + 1) % PROPS.length
  const prevProp = PROPS[prevIdx]
  const currProp = PROPS[selectedIndex]
  const nextProp = PROPS[nextIdx]

  return (
    <UiEntity
      uiTransform={{
        width: 660, height: 468,
        flexDirection: 'column', alignItems: 'center',
        positionType: 'absolute', position: { top: 40, left: '50%' },
        margin: { left: -330 },
      }}
    >
      {/* ── Header ── */}
      <UiEntity
        uiTransform={{ width: 660, height: 68, alignItems: 'center', justifyContent: 'center', borderRadius: 14 }}
        uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0.85 } }}
      >
        <OutlinedLabel value="GET  READY!" width={600} height={58} fontSize={46} color={YELLOW} />
      </UiEntity>

      <UiEntity uiTransform={{ width: 660, height: 10 }} />

      {/* ── Cards ── */}
      <UiEntity uiTransform={{ width: 660, height: 390, flexDirection: 'row', justifyContent: 'space-between' }}>

        {/* ── PROP TEAM ── */}
        <UiEntity
          uiTransform={{ width: 322, height: 390, flexDirection: 'column', alignItems: 'center', borderRadius: 16 }}
          uiBackground={{ color: isHider ? GRN_CARD : GRN_DIM }}
        >
          {/* Colored header with title */}
          <UiEntity
            uiTransform={{ width: 322, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 16 }}
            uiBackground={{ color: { r: 0.12, g: 0.52, b: 0.18, a: isHider ? 1 : 0.5 } }}
          >
            <OutlinedLabel value="PROP TEAM" width={290} height={46} fontSize={30} color={WHITE} />
          </UiEntity>

          <UiEntity uiTransform={{ width: 290, flexDirection: 'column', alignItems: 'center', padding: { top: 16 } }}>
            <OutlinedLabel value="Change your shape using" width={290} height={26} fontSize={17} color={isHider ? WHITE : DIM_TEXT} />
            <OutlinedLabel value="E and F to blend in!" width={290} height={26} fontSize={17} color={isHider ? WHITE : DIM_TEXT} />

            {/* Prop carousel */}
            <UiEntity
              uiTransform={{ width: 290, height: 100, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', margin: { top: 16 }, borderRadius: 10 }}
              uiBackground={{ color: KEY_BG }}
            >
              <OutlinedLabel value="◄ E" width={80} height={44} fontSize={22} color={GREEN} />
              <UiEntity uiTransform={{ width: 76, height: 76, margin: { left: 8, right: 8 }, borderRadius: 8 }}
                uiBackground={currProp.src !== '' && currProp.thumbnail ? { texture: { src: currProp.thumbnail }, textureMode: 'stretch' } : { color: THUMB_BG }}
              />
              <OutlinedLabel value="F ►" width={80} height={44} fontSize={22} color={GREEN} />
            </UiEntity>

            <OutlinedLabel value="Survive until time runs out!" width={290} height={26} fontSize={15} marginTop={14} color={isHider ? YELLOW : DIM_TEXT} />
          </UiEntity>

          {/* YOUR TEAM badge — always at bottom */}
          {isHider && (
            <UiEntity
              uiTransform={{ width: 120, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 6, positionType: 'absolute', position: { bottom: 16 } }}
              uiBackground={{ color: GREEN }}
            >
              <Label value="YOUR TEAM" uiTransform={{ width: 120, height: 28 }} textAlign="middle-center" fontSize={14} color={BLACK} />
            </UiEntity>
          )}
        </UiEntity>

        {/* ── HUNTER TEAM ── */}
        <UiEntity
          uiTransform={{ width: 322, height: 390, flexDirection: 'column', alignItems: 'center', borderRadius: 16 }}
          uiBackground={{ color: !isHider ? RED_CARD : RED_DIM }}
        >
          {/* Colored header with title */}
          <UiEntity
            uiTransform={{ width: 322, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 16 }}
            uiBackground={{ color: { r: 0.55, g: 0.08, b: 0.08, a: !isHider ? 1 : 0.5 } }}
          >
            <OutlinedLabel value="HUNTER TEAM" width={290} height={46} fontSize={30} color={WHITE} />
          </UiEntity>

          <UiEntity uiTransform={{ width: 290, flexDirection: 'column', alignItems: 'center', padding: { top: 16 } }}>
            <OutlinedLabel value="Find and eliminate all hiders" width={290} height={26} fontSize={17} color={!isHider ? WHITE : DIM_TEXT} />
            <OutlinedLabel value="before time runs out." width={290} height={26} fontSize={17} color={!isHider ? WHITE : DIM_TEXT} />

            {/* Controls with images */}
            <UiEntity
              uiTransform={{ width: 290, height: 100, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', margin: { top: 16 }, borderRadius: 10 }}
              uiBackground={{ color: KEY_BG }}
            >
              <UiEntity uiTransform={{ width: 110, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <UiEntity uiTransform={{ width: 56, height: 56, borderRadius: 8 }}
                  uiBackground={{ texture: { src: 'assets/images/target.png' }, textureMode: 'stretch' }}
                />
                <OutlinedLabel value="AIM" width={90} height={22} fontSize={14} marginTop={6} color={WHITE} />
              </UiEntity>
              <UiEntity uiTransform={{ width: 1, height: 70 }} uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.12 } }} />
              <UiEntity uiTransform={{ width: 110, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <UiEntity uiTransform={{ width: 56, height: 56, borderRadius: 8 }}
                  uiBackground={{ texture: { src: 'assets/images/mouse_icon.png' }, textureMode: 'stretch' }}
                />
                <OutlinedLabel value="SHOOT" width={90} height={22} fontSize={14} marginTop={6} color={WHITE} />
              </UiEntity>
            </UiEntity>

            <OutlinedLabel value="Shoot them all to win!" width={290} height={26} fontSize={15} marginTop={14} color={!isHider ? YELLOW : DIM_TEXT} />
          </UiEntity>

          {/* YOUR TEAM badge — always at bottom */}
          {!isHider && (
            <UiEntity
              uiTransform={{ width: 120, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 6, positionType: 'absolute', position: { bottom: 16 } }}
              uiBackground={{ color: RED }}
            >
              <Label value="YOUR TEAM" uiTransform={{ width: 120, height: 28 }} textAlign="middle-center" fontSize={14} color={BLACK} />
            </UiEntity>
          )}
        </UiEntity>

      </UiEntity>
    </UiEntity>
  )
}

function ResultsPanel() {
  const shootersWon = uiState.winner === 'shooters'
  const title = shootersWon ? 'SHOOTERS WIN!' : 'HIDERS WIN!'
  const color = shootersWon ? RED : GREEN
  return (
    <UiEntity
      uiTransform={{ width: 500, height: 220, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', positionType: 'absolute', position: { top: '50%', left: '50%' }, margin: { top: -110, left: -250 } }}
      uiBackground={{ color: BG_DARK }}
    >
      <OutlinedLabel value={title} width={480} height={80} fontSize={46} color={color} />
      <OutlinedLabel
        value={shootersWon ? 'All hiders were found!' : 'Hiders survived!'}
        width={480} height={40} fontSize={26} marginTop={12}
      />
      <OutlinedLabel value="New game starting soon..." width={480} height={36} fontSize={20} marginTop={8} />
    </UiEntity>
  )
}

function DebugBar(props: { phase: string; role: string }) {
  const ACCENT: Color4 = { r: 1, g: 0.6, b: 0, a: 1 }
  return (
    <UiEntity
      uiTransform={{
        width: 340, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        padding: { left: 14, right: 14 },
        positionType: 'absolute', position: { top: 12, right: 12 },
        borderRadius: 10,
      }}
      uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0.85 } }}
    >
      <OutlinedLabel value="DEBUG" width={80} height={36} fontSize={18} color={ACCENT} />
      <OutlinedLabel value={`[1] ${props.phase.toUpperCase()}`} width={130} height={36} fontSize={16} color={WHITE} />
      <OutlinedLabel value={`[2] ${props.role.toUpperCase()}`} width={90} height={36} fontSize={16} color={props.role === 'hider' ? GREEN : RED} />
    </UiEntity>
  )
}

export const uiMenu = () => {
  const phase      = DEBUG ? DEBUG_PHASES[dbgPhaseIdx] : uiState.phase
  const activeRole = DEBUG ? dbgRole : playerRole

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between' }}>
      {DEBUG && <DebugBar phase={phase} role={activeRole} />}
      {phase === 'cinematic' && <CinematicPanel role={activeRole} />}
      {phase === 'lobby'     && <LobbyPanel />}
      {phase === 'hiding'    && activeRole === 'hider'   && <HidingPanelHider />}
      {phase === 'hiding'    && activeRole === 'shooter'  && <HidingPanelShooter />}
      {phase === 'playing'   && <PlayingHUD />}
      {phase === 'results'   && <ResultsPanel />}
    </UiEntity>
  )
}
