# Venetian Hunt

`Venetian Hunt` is a multiplayer Decentraland prop hunt game built with SDK7 and authoritative multiplayer.

Players are split into two teams:
- `Hiders / Props`: disguise themselves as scene props and survive until time runs out.
- `Hunters / Shooters`: search for disguised players and eliminate them before the timer ends.

The project is configured as a World scene:
- World name: `carrito.dcl.eth`
- Runtime: `SDK7`
- Multiplayer: `authoritativeMultiplayer: true`

## Gameplay Loop

Each match runs through these phases:

1. `Lobby`
   Players connect, sync with the server, and wait until the match can start.

2. `Cinematic`
   Roles are assigned and players are moved to their team boats.

3. `Hiding`
   Hiders choose a prop and move into the map.
   Hunters remain in place until the round opens.

4. `Playing`
   Hunters enter the island and can shoot.
   Hiders stay disguised and try to survive.

5. `Results`
   The winner is shown briefly, then the game resets back to lobby.

## Core Design

The scene uses a server-authoritative setup for game flow:
- the server owns round phase changes
- the server assigns roles
- the server validates shots and eliminations
- the client handles presentation, local input, VFX, UI, and movement feedback

## Key Systems

### 1. Authoritative Match Flow

The server lives in [src/server/server.ts](./src/server/server.ts).

It is responsible for:
- tracking connected and ready players
- assigning shooters and hiders
- starting and ending phases with timers
- validating prop selection
- validating shooting and hider health
- resetting the match back to lobby

Shared synced state is defined in [src/shared/schemas.ts](./src/shared/schemas.ts):
- `GameStateComponent`
- `RolesComponent`
- `DisguisedPlayersComponent`

Network messages are declared in [src/shared/messages.ts](./src/shared/messages.ts).

### 2. Avatar Hiding

Avatar visibility is handled in [src/avatarHiding.ts](./src/avatarHiding.ts).

Current behavior:
- the `AvatarModifierArea` is created once
- it is only activated during `hiding` and `playing`
- it hides all avatars with no `excludeIds`
- it is removed outside active gameplay phases

This was chosen as a practical workaround for mobile issues with dynamic `excludeIds`.

### 3. Prop Disguises

Hider disguises are split into two parts:

- local prop attach and selection UI in [src/ui.tsx](./src/ui.tsx)
- remote prop reconstruction and syncing in [src/client/propSystem.ts](./src/client/propSystem.ts)

Useful supporting files:
- [src/props.ts](./src/props.ts)
- [src/propSpawnPoints.ts](./src/propSpawnPoints.ts)
- [src/propUtils.ts](./src/propUtils.ts)

### 4. Hunter Dummy + Weapon Sync

Because real avatar rendering was unreliable for the intended gameplay on mobile, remote hunters are represented by a custom dummy system in [src/client/shooterWeapons.ts](./src/client/shooterWeapons.ts).

That system handles:
- remote hunter body rendering
- weapon attach
- aim synchronization
- animation blending for idle, run, aim up/down, and run+shoot states
- remote muzzle alignment used by bullet/VFX presentation

Related files:
- [src/client/shooterSystem.ts](./src/client/shooterSystem.ts)
- [src/client/remoteBullets.ts](./src/client/remoteBullets.ts)
- [src/client/audioManager.ts](./src/client/audioManager.ts)

### 5. UI / HUD

Most screen-space UI lives in [src/ui.tsx](./src/ui.tsx).

This includes:
- lobby panel
- cinematic instruction cards
- hider selector
- playing HUD
- mobile shoot button
- crosshair
- elimination / result overlays

The project currently supports different UX patterns for desktop and mobile where needed.

## Controls

### Desktop

- `E / F`: cycle prop while hiding / playing as hider
- `Start Game` button in lobby
- mouse aim + shoot as hunter

### Mobile

- touch aim
- mobile shoot button for hunters
- mobile-specific instruction cards
- mobile hider selector UI

## Project Structure

```text
src/
  avatarHiding.ts        AvatarModifierArea lifecycle
  index.ts               client/server bootstrap
  props.ts               prop spawning
  propSpawnPoints.ts     valid prop definitions and spawn mapping
  propUtils.ts           prop helpers and transforms
  ui.tsx                 HUD, menus, mobile controls, local prop attach

  client/
    setup.ts             main client orchestration
    propSystem.ts        remote prop disguise sync
    shooterSystem.ts     local shooting logic
    shooterWeapons.ts    hunter dummy + weapon animation sync
    remoteBullets.ts     remote bullet/VFX presentation
    hiderHealth.ts       remote health bar logic
    audioManager.ts      gameplay audio
    waterTrigger.ts      scene trigger logic

  server/
    server.ts            authoritative game loop

  shared/
    messages.ts          network message schema
    schemas.ts           synced component schema
```

## Running Locally

Install dependencies:

```bash
npm install
```

Start preview:

```bash
npm start
```

Build:

```bash
npm run build
```

Useful command:

```bash
npm run server-logs
```

## Scene Configuration

Main scene config is in [scene.json](./scene.json).

Important settings:
- `authoritativeMultiplayer: true`
- `worldConfiguration.name: carrito.dcl.eth`
- `ALLOW_TO_TRIGGER_AVATAR_EMOTE`
- `ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE`

## Notes

- The project is designed around a mobile-compatible workaround for avatar hiding.
- The most complex part of the scene is the remote hunter presentation system.
- If you change hunter weapon offsets or animation logic, re-test:
  - remote bullets
  - remote muzzle flash
  - hiding presentation
  - mobile gameplay
