import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from '@dcl/sdk/react-ecs'
import {
  engine,
  inputSystem, InputAction, PointerEventType,
  GltfContainer, ColliderLayer, Transform,
  AvatarModifierArea, AvatarModifierType,
  Entity
} from '@dcl/sdk/ecs'


import { Color4 } from '@dcl/sdk/math'

const PROPS = [
  { name: 'Chair',          thumbnail: 'assets/images/props/chair.png',        src: 'assets/asset-packs/outdoor_chair/Chair_07.glb' },
  { name: 'Bicycle',        thumbnail: 'assets/images/props/bicycle.png',       src: 'assets/asset-packs/blue_bicycle/Bicycle_02/Bicycle_02.glb' },
  { name: 'Lamp Post',      thumbnail: 'assets/images/props/lamppost.png',      src: 'assets/asset-packs/traditional_lamp_post/LampPost_02/LampPost_02.glb' },
  { name: 'Clay Pot',       thumbnail: 'assets/images/props/pot.png',           src: 'assets/asset-packs/clay_pot/Pot_01/Pot_01.glb' },
  { name: 'Bird Fountain',  thumbnail: 'assets/images/props/birdfountain.png',  src: 'assets/asset-packs/bird_fountain/BirdFountain_01/BirdFountain_01.glb' },
  { name: 'Umbrella Table', thumbnail: 'assets/images/props/table.png',         src: 'assets/asset-packs/umbrella_table/TableBar_01/TableBar_01.glb' },
  { name: 'Fern Pot',       thumbnail: 'assets/images/props/fernpot.png',       src: 'assets/asset-packs/planted_fern/PlantPot_03/PlantPot_03.glb' },
  { name: 'Fountain',       thumbnail: 'assets/images/props/fountain.png',      src: 'assets/asset-packs/the_lonely_fountain/Fountain_03/Fountain_03.glb' },
]

let selectedIndex = 0
let propEntity: Entity | undefined

function setupModifierArea() {
  const modifierEntity = engine.addEntity()
  AvatarModifierArea.create(modifierEntity, {
    area: { x: 2, y: 3, z: 2 },
    modifiers: [AvatarModifierType.AMT_HIDE_AVATARS, AvatarModifierType.AMT_DISABLE_PASSPORTS],
    excludeIds: []
  })
  Transform.create(modifierEntity, {
    parent: engine.PlayerEntity,
    position: { x: 0, y: 1, z: 0 }
  })
}

function attachProp(src: string) {
  if (propEntity !== undefined) engine.removeEntity(propEntity)

  propEntity = engine.addEntity()
  GltfContainer.create(propEntity, {
    src,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
  })
  Transform.create(propEntity, {
    parent: engine.PlayerEntity,
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  })
}

export function setupUi() {
  setupModifierArea()
  attachProp(PROPS[selectedIndex].src)

  engine.addSystem(() => {
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

const BG_DARK: Color4  = { r: 0, g: 0, b: 0, a: 0.72 }
const BG_KEY: Color4   = { r: 1, g: 1, b: 1, a: 0.15 }
const WHITE: Color4    = { r: 1, g: 1, b: 1, a: 1    }

export const uiMenu = () => {
  const prop = PROPS[selectedIndex]

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
      }}
    >
      <UiEntity
        uiTransform={{
          width: 440,
          flexDirection: 'column',
          alignItems: 'center',
          margin: { bottom: 64 },
        }}
        uiBackground={{ color: BG_DARK }}
      >
        <UiEntity
          uiTransform={{
            width: 440,
            height: 140,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: { left: 16, right: 16 },
          }}
        >
          {/* E key — prev */}
          <UiEntity
            uiTransform={{ width: 72, height: 72, alignItems: 'center', justifyContent: 'center' }}
            uiBackground={{ color: BG_KEY }}
          >
            <Label
              value="◄  E"
              uiTransform={{ width: '100%', height: '100%' }}
              textAlign="middle-center"
              fontSize={22}
              color={WHITE}
            />
          </UiEntity>

          {/* Thumbnail + name */}
          <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center' }}>
            <UiEntity
              uiTransform={{ width: 120, height: 120 }}
              uiBackground={{ texture: { src: prop.thumbnail }, textureMode: 'stretch' }}
            />
            <Label
              value={prop.name}
              uiTransform={{ width: 200, height: 32, margin: { top: 6 } }}
              textAlign="middle-center"
              fontSize={20}
              color={WHITE}
            />
          </UiEntity>

          {/* F key — next */}
          <UiEntity
            uiTransform={{ width: 72, height: 72, alignItems: 'center', justifyContent: 'center' }}
            uiBackground={{ color: BG_KEY }}
          >
            <Label
              value="F  ►"
              uiTransform={{ width: '100%', height: '100%' }}
              textAlign="middle-center"
              fontSize={22}
              color={WHITE}
            />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
