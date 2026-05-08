import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from '@dcl/sdk/react-ecs'
import {
  engine,
  inputSystem, InputAction, PointerEventType,
  GltfContainer, ColliderLayer, Transform,
  PlayerIdentityData,
  Entity
} from '@dcl/sdk/ecs'
import { getUserData } from '~system/UserIdentity'
import { room } from './shared/messages'
import { addVisiblePlayer, removeVisiblePlayer } from './avatarHiding'
import { Color4, Quaternion } from '@dcl/sdk/math'
import { activateShooter, deactivateShooter } from './client/shooterSystem'

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
let propEntity:   Entity | undefined
let weaponEntity: Entity | undefined
let playerRole: 'hider' | 'shooter' = 'hider'

export function getCurrentPropSrc(): string {
  return PROPS[selectedIndex].src
}

export function setPlayerRole(role: 'hider' | 'shooter') {
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
        parent: engine.PlayerEntity,
        position: { x: 0.4, y: 1.1, z: 0.5 },
        rotation: Quaternion.fromEulerDegrees(0, 90, 0),
        scale: { x: 0.02, y: 0.02, z: 0.02 },
      })
    }
    activateShooter()
  } else {
    if (weaponEntity !== undefined) {
      engine.removeEntity(weaponEntity)
      weaponEntity = undefined
    }
    deactivateShooter()
  }
}

function attachProp(src: string) {
  if (propEntity !== undefined) {
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
}

export function setupUi() {
  getUserData({}).then(({ data }) => {
    const body = data?.avatar?.snapshots?.body
    if (body) PROPS[PROPS.length - 1].thumbnail = body
  }).catch(() => {})

  attachProp(PROPS[selectedIndex].src)

  engine.addSystem(() => {
    if (playerRole !== 'hider') return
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

const WHITE:        Color4 = { r: 1,    g: 1,    b: 1,    a: 1    }
const BLACK:        Color4 = { r: 0,    g: 0,    b: 0,    a: 1    }
const RED:          Color4 = { r: 0.9,  g: 0.2,  b: 0.2,  a: 1    }
const GREEN:        Color4 = { r: 0.2,  g: 0.85, b: 0.3,  a: 1    }
const BG_BTN:       Color4 = { r: 0,    g: 0,    b: 0,    a: 0.55 }

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

export const uiMenu = () => {
  const prop = PROPS[selectedIndex]
  const roleColor = playerRole === 'shooter' ? RED : GREEN

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {/* ── Top: role badge + DEBUG switch button ── */}
      <UiEntity
        uiTransform={{
          width: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          margin: { top: 32 },
        }}
      >
        <OutlinedLabel
          value={playerRole === 'shooter' ? '🔫  SHOOTER' : '🫥  HIDER'}
          width={280} height={48} fontSize={28} color={roleColor}
        />
        <UiEntity
          uiTransform={{ width: 140, height: 48, alignItems: 'center', justifyContent: 'center', margin: { left: 16 } }}
          uiBackground={{ color: BG_BTN }}
          onMouseDown={() => room.send('debugSwitchRole', {})}
        >
          <Label value="SWITCH ROLE" uiTransform={{ width: 140, height: 48 }}
            textAlign="middle-center" fontSize={18} color={WHITE} />
        </UiEntity>
      </UiEntity>

      {/* ── Bottom: prop selector (hiders only) ── */}
      {playerRole === 'hider' && (
        <UiEntity
          uiTransform={{
            width: 440,
            height: 140,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: { left: 16, right: 16 },
            margin: { bottom: 64 },
          }}
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
      )}
    </UiEntity>
  )
}
