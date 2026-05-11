import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from '@dcl/sdk/react-ecs'
import {
  engine,
  inputSystem, InputAction, PointerEventType,
  GltfContainer, ColliderLayer, Transform, VisibilityComponent,
  PlayerIdentityData, CameraModeArea, CameraType,
  Entity
} from '@dcl/sdk/ecs'
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
  { name: 'Bicycle',        thumbnail: 'assets/images/props/bicycle.png',       src: 'assets/asset-packs/blue_bicycle/Bicycle_02/Bicycle_02.glb' },
  { name: 'Lamp Post',      thumbnail: 'assets/images/props/lamppost.png',      src: 'assets/asset-packs/traditional_lamp_post/LampPost_02/LampPost_02.glb' },
  { name: 'Clay Pot',       thumbnail: 'assets/images/props/pot.png',           src: 'assets/asset-packs/clay_pot/Pot_01/Pot_01.glb' },
  { name: 'Bird Fountain',  thumbnail: 'assets/images/props/birdfountain.png',  src: 'assets/asset-packs/bird_fountain/BirdFountain_01/BirdFountain_01.glb' },
  { name: 'Umbrella Table', thumbnail: 'assets/images/props/table.png',         src: 'assets/asset-packs/umbrella_table/TableBar_01/TableBar_01.glb' },
  { name: 'Fern Pot',       thumbnail: 'assets/images/props/fernpot.png',       src: 'assets/asset-packs/planted_fern/PlantPot_03/PlantPot_03.glb' },
  { name: 'Fountain',       thumbnail: 'assets/images/props/fountain.png',      src: 'assets/asset-packs/the_lonely_fountain/Fountain_03/Fountain_03.glb' },
  { name: 'Avatar',         thumbnail: '',                                       src: '' },
]

let selectedIndex = 0
let propEntity:    Entity | undefined
let weaponEntity:  Entity | undefined
let camAreaEntity: Entity | undefined
let playerRole: 'hider' | 'shooter' = 'hider'

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
  GltfContainer.create(propEntity, {
    src,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
  })
  Transform.create(propEntity, {
    parent: engine.PlayerEntity,
    position: { x: 0, y: -0.1, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
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
  const canStart = count >= 2
  return (
    <UiEntity
      uiTransform={{ width: 400, height: 240, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', positionType: 'absolute', position: { top: '50%', left: '50%' }, margin: { top: -120, left: -200 } }}
      uiBackground={{ color: BG_DARK }}
    >
      <OutlinedLabel value="PROP HUNT" width={380} height={64} fontSize={48} color={YELLOW} />
      <OutlinedLabel value={`${count} player${count === 1 ? '' : 's'} connected`} width={380} height={36} fontSize={22} marginTop={8} />
      <UiEntity
        uiTransform={{ width: 280, height: 56, alignItems: 'center', justifyContent: 'center', margin: { top: 20 } }}
        uiBackground={{ color: canStart ? GREEN : BG_PANEL }}
        onMouseDown={() => { if (canStart) room.send('startGame', {}) }}
      >
        <Label
          value={canStart ? 'START GAME' : 'Need 2+ players'}
          uiTransform={{ width: 280, height: 56 }}
          textAlign="middle-center"
          fontSize={26}
          color={canStart ? BLACK : { r: 0.5, g: 0.5, b: 0.5, a: 1 }}
        />
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
        uiTransform={{ width: 440, height: 140, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: { left: 16, right: 16 } }}
        uiBackground={{ color: BG_PANEL }}
      >
        <OutlinedLabel value="◄  E" width={72} height={72} fontSize={26} />
        <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center' }}>
          <UiEntity
            uiTransform={{ width: 120, height: prop.src === '' ? 200 : 120 }}
            uiBackground={{ texture: { src: prop.thumbnail }, textureMode: 'stretch' }}
          />
          <OutlinedLabel value={prop.name.toUpperCase()} width={200} height={32} fontSize={20} marginTop={6} />
        </UiEntity>
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
          <OutlinedLabel value={playerRole === 'shooter' ? '🔫  SHOOTER' : '🫥  HIDER'} width={200} height={44} fontSize={26} color={roleColor} />
          <OutlinedLabel value={timeStr} width={100} height={44} fontSize={30} color={YELLOW} />
          {playerRole === 'shooter' && (
            <OutlinedLabel value={`${uiState.hidersLeft} left`} width={120} height={44} fontSize={24} color={WHITE} />
          )}
          {playerRole === 'hider' && (
            <OutlinedLabel
              value={`♥ ${uiState.localHealth}/10`}
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
            uiTransform={{ width: 440, height: 140, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: { left: 16, right: 16 } }}
            uiBackground={{ color: BG_PANEL }}
          >
            <OutlinedLabel value="◄  E" width={72} height={72} fontSize={26} />
            <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center' }}>
              <UiEntity
                uiTransform={{ width: 120, height: PROPS[selectedIndex].src === '' ? 200 : 120 }}
                uiBackground={{ texture: { src: PROPS[selectedIndex].thumbnail }, textureMode: 'stretch' }}
              />
              <OutlinedLabel value={PROPS[selectedIndex].name.toUpperCase()} width={200} height={32} fontSize={20} marginTop={6} />
            </UiEntity>
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

function CinematicPanel() {
  const isHider  = playerRole === 'hider'
  const teamName = isHider ? 'PROPS' : 'HUNTERS'
  const color    = isHider ? GREEN : RED
  return (
    <UiEntity
      uiTransform={{ width: 600, height: 180, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', positionType: 'absolute', position: { top: '50%', left: '50%' }, margin: { top: -90, left: -300 } }}
      uiBackground={{ color: BG_DARK }}
    >
      <OutlinedLabel value="GET READY!" width={580} height={80} fontSize={56} color={YELLOW} />
      <OutlinedLabel value={`You are on the ${teamName} team`} width={580} height={56} fontSize={30} marginTop={8} color={color} />
    </UiEntity>
  )
}

function ResultsPanel() {
  const shootersWon = uiState.winner === 'shooters'
  const title = shootersWon ? '🔫  SHOOTERS WIN!' : '🫥  HIDERS WIN!'
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

export const uiMenu = () => {
  const phase = uiState.phase

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between' }}>
      {phase === 'cinematic' && <CinematicPanel />}
      {phase === 'lobby'   && <LobbyPanel />}
      {phase === 'hiding'  && playerRole === 'hider'   && <HidingPanelHider />}
      {phase === 'hiding'  && playerRole === 'shooter'  && <HidingPanelShooter />}
      {phase === 'playing' && <PlayingHUD />}
      {phase === 'results' && <ResultsPanel />}
    </UiEntity>
  )
}
