import { isServer } from '@dcl/sdk/network'
// engine.defineComponent and registerMessages must run synchronously before the engine seals
import './shared/schemas'
import './shared/messages'

export async function main() {
  if (isServer()) {
    const { initServer } = await import('./server/server')
    initServer()
    return
  }

  const { initClient } = await import('./client/setup')
  const { setupUi } = await import('./ui')
  const { setupAvatarHiding } = await import('./avatarHiding')
  const { spawnProps } = await import('./props')

  setupAvatarHiding()
  initClient()
  setupUi()
  spawnProps()
  await import('./client/waterTrigger')
}
