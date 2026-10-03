# Rulebreaker

[Source repository](https://github.com/jonah-ux/rulebreaker)

A browser laboratory for inspectable laws in a simulated world.

**Status: the first playable physics slice is shipped in source.** The room, typed laws, object selection, collision-note policy, and temporary freeze are usable without credentials. The live model adapter, undo/branch history, and experiment import/export remain future slices.

## Try the room

Open the app and use the three prepared laws in the panel:

- **Blue objects fall upward** scopes inverted gravity to the two blue prisms. Red and gold keep ordinary gravity.
- **Every collision plays a note** listens for meaningful Rapier collision events. Impacts below 1.2 m/s are ignored, each pair has a 24-tick cooldown, and playback is capped at four voices. Click **Enable audio** once when the browser asks for a gesture.
- **Click to freeze for three seconds** adds a 180-tick simulation-time freeze. Select a body in the inspector, use the freeze button, or enter click mode and click a shape. The body returns to dynamic motion when the timer expires.

Drag the room to orbit, scroll to zoom, and click a shape to select it. The inspector is keyboard-friendly, and the prepared/live-AI distinction stays visible in the mode card. No model credentials are required.

## Start locally

Use Node.js 22.12 or newer and npm. From a clean clone:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Each of the three creative projects uses a different development port.

## Checks

```sh
npm run verify
```

This runs lint, TypeScript, engine/schema checks, and the production build. CI runs the same command after a locked install. Browser/audio acceptance is additional product proof; a build alone is not that proof.

## Build the product

Start with [AGENTS.md](AGENTS.md), then give an agent the complete [build prompt](docs/BUILD-PROMPT.md). [NEXT-STEPS.md](docs/NEXT-STEPS.md) tracks the delivered physics slice and the remaining first-release work.

The next coherent slices are the server-side AI law adapter, complete state restore, branching, and experiment import/export. Keep prepared behavior separate from live provider output until a real configured provider has completed the request → validation → engine-effect path.

## Architecture

`src/domain.ts` owns scene and versioned law validation. `src/simulation.ts` owns the Rapier world, fixed 60 Hz stepping, typed gravity/collision/freeze operations, collision cooldowns, freeze expiry, and bounded event output. `src/World.tsx` owns the Three.js renderer, orbit controls, raycast selection, and presentation of observed engine state. `src/App.tsx` owns prepared law controls and the explicit Web Audio gesture. `src/scene.json` is the sample scene.

Keep model output as validated data and provider secrets on a future server-side adapter. There is still no server or provider connection in the prepared slice; no environment credential is needed or read. See [architecture](docs/ARCHITECTURE.md).

## Provenance

The project uses the official Vite React/TypeScript template, Three.js, Rapier, Zod, and public dependencies recorded in the lockfile. Original sample data and prepared behavior were authored with AI assistance. Generative-world projects such as [Genie](https://deepmind.google/models/genie/) are a related reference; Rulebreaker's contribution is the inspectable, typed law loop and persistent physics consequences in a small open-source room. [MIT license](LICENSE).
