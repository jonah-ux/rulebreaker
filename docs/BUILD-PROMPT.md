# Build Rulebreaker: a world whose laws you can rewrite

## Your mission

Build and publish an independently usable open-source project provisionally named **Rulebreaker**, targeting `jonah-ux/rulebreaker`. Deliver a polished browser experience where a player describes a strange law, sees the AI interpret it, applies it to a real simulated world, experiments with the consequences, and can undo or branch the experiment.

The desired reaction is: “I changed the laws of this room, and now I want to try something else.” Own the whole first release: product design, implementation, useful tests, visible browser verification, documentation, and repository delivery. A plan, scaffolding, chat interface, or generated screenshot is not the outcome.

## Context, ownership, and scope

- Jonah wants ambitious, fun public projects with a clear original contribution. Use an ordinary computer and browser; require no special boards, sensors, headset, or new hardware.
- Check whether the target repository already exists. Inspect ownership, instructions, current branches, and work in progress before editing. Reuse a suitable existing checkout or isolated worktree; preserve other people's changes. If the name is occupied by an unrelated project, propose a suitable available name without replacing it.
- If absent, create the standalone project and publish its reviewed contents to a new public repository in Jonah's account through the available authorized GitHub route. Do not invent authorship or modify profile pins or other projects.
- Keep the project portable. It must run without private Fleet, Portal, Atlas, or Forgeyard services. Existing development tools may help you build it, but they must not become product runtime dependencies.
- Follow the applicable repository and host instructions. Use governed merge/release owners where required. A gate failure is a condition to resolve or report, never permission to bypass it. Preserve published history.
- Use small reviewable changes and truthful Conventional Commits. Make routine implementation choices yourself. Ask only for information or authority that materially blocks the concrete next step; continue independent work meanwhile. Keep any delegation bounded with explicit file ownership and shared-state protection.

## The experience to deliver

Open directly into an attractive, interactive room containing a floor, recognizable colored objects, and a simple goal. Explain controls briefly. Give the player a working orbit or first-person camera and a reliable way to select objects.

The first-release AI design space must support these three interactions:

1. **“Blue objects fall upward.”** Apply a scoped gravity rule to blue objects. Objects outside the selection retain their current rules. Position changes must result from the physics engine.
2. **“Every collision plays a note.”** Turn meaningful impact events into short sounds. Define the impact threshold, cooldown, and voice limit so persistent contacts do not produce uncontrolled event storms. Explain the interpretation in the UI.
3. **“Click an object to freeze it for three seconds.”** Install an interaction rule with a simulation-time expiry. On expiry, restore a documented dynamic state without losing other active laws.

The exact wording need not be hard-coded: support alternate phrasings and valid combinations through the model adapter. Broader imaginative laws can become later capabilities after these work reliably.

The interaction loop is **describe → interpret → inspect affected objects → apply → play → undo/branch**. Show a concise interpretation, affected scope, and any ambiguity before applying a proposed law. Let the player approve, edit, or cancel it. An unsupported request should invite a useful supported variation and preserve the current world.

Ship a guided “Impossible Room” sequence that demonstrates the three laws and invites the player to invent a variation. Include an honest no-key mode using labeled prepared laws, plus a separately identified live-AI mode. Prepared behavior must never masquerade as a live model response.

## Original contribution and visual direction

Investigate the closest relevant projects briefly and record their relationships and licenses. Generative worlds already exist. Pursue a distinctive contribution: **inspectable laws, persistent consequences, composable interactions, and replayable experiments in a shareable open-source format**.

Use a playful laboratory aesthetic: a world that occupies most of the screen, clear color/shape vocabulary, satisfying motion, restrained lighting, readable controls, and a compact law panel. Make object selection and rule activation visibly legible. Include keyboard access, visible focus, reduced-motion accommodations for presentation effects, and explicit sound activation.

The product should feel inviting. Keep CI, provider internals, and developer diagnostics out of the main play flow; expose them in an optional inspector.

## Engineering boundaries

Prefer a small TypeScript application with a browser renderer, an established physics engine, and a thin server-side model adapter. React/Vite, Three.js, and Rapier are reasonable defaults; inspect current documentation and choose simpler proven alternatives if justified. Pin dependencies in a lockfile. Avoid a framework platform or unnecessary service topology.

Separate these concerns clearly:

- **World engine:** authoritative object identities, tags, physics state, active laws, timers, and interaction events.
- **Law schema and interpreter:** a versioned data format with explicit selectors, supported conditions/actions, bounded values, precedence, and refusal reasons.
- **AI adapter:** converts a player's request plus a bounded world description into a validated proposal in that format.
- **Presentation:** renders observed engine state and provides the actual controls.
- **Experiment storage:** saves scene definitions, rule changes, seeds, events, and complete restore state.

AI output is untrusted data. The model may propose only supported operations; it must not emit or execute arbitrary JavaScript, shell commands, remote imports, or tool actions. Validate IDs, scope, counts, finite numbers, limits, and version before changing the engine. Applying a proposal must be atomic: invalid input leaves the prior world unchanged. Do not embed provider keys in the browser bundle. Select providers from documented server configuration, bound requests and retries, and make cancellation work.

Define how laws compose. Do not leave conflicting selectors or temporary rules dependent on iteration order. Show conflicts to the player or use a documented stable precedence rule. Validate the complete proposed change before its first effect.

Use a fixed simulation step and a seeded source of randomness. Replay should initially be supported for a declared engine version and tested environment. Cross-browser determinism is a separate claim that needs evidence. A physics snapshot alone is insufficient: restore laws, timers, pending events, RNG state, object-to-body mappings, and UI selections consistently. Replaying or undoing must not reissue model requests or duplicate audio playback.

Bound object counts, histories, event queues, generated proposals, and audio voices. Preserve the working world across provider failure, timeout, cancellation, or an invalid proposal. Clean up rendering/physics/audio resources on reset and navigation.

## Build sequence

1. **Playable engine first.** Deliver the room and three manually applied typed laws, including visible effects, restore behavior, and conflict handling. Establish a visually convincing vertical slice early.
2. **Real AI interpretation.** Connect one documented provider adapter. Test non-identical phrasings and malformed responses. Keep a labeled no-key mode fully functional. No model training is required.
3. **Experiment loop.** Add undo, restoration, one timeline branch, local save/load, and a versioned export/import format. An imported experiment must actually reproduce its declared behavior.
4. **First release.** Finish the guided demo, accessibility, runtime bounds, docs, screenshots or a short recording, clean-clone installation proof, and repository publication.

Complete each working slice before adding capabilities. Defer multiplayer, arbitrary code generation, limitless laws, photorealistic world generation, accounts, billing, and asset marketplaces.

## Acceptance criteria

Collect rerunnable evidence for these product behaviors:

- Each named law produces the expected engine effect, including a combined-law case. Assert positions/velocities or rule state rather than checking only a visual label.
- Non-selected objects remain outside a scoped change; temporary freeze expires at the documented simulation tick; repeated contacts obey the sound policy.
- Undo restores the complete pre-change state. Restoring a branch and replaying the same input sequence reproduces the supported state comparison without another model call.
- Export an experiment, reset the app, import it, and perform its actual controls again. Invalid versions and broken references are refused without partial mutation.
- Invalid model output, unsupported operations, non-finite values, timeout, and cancellation preserve the working world and provide an understandable result.
- A fresh no-key visitor can complete the guided demo. At least one configured real provider must complete request → validated law → actual engine effect before live AI is called verified. If authorized credentials are unavailable, deliver everything else and identify precisely this missing proof.
- Browser verification uses the running app and actual controls. Capture the interpreted law and its visible effect, not just the home page. Describe which browsers were exercised and which were not.
- Report measured frame timing and resource behavior on the named test machine for the shipped scene. Do not advertise an invented FPS target or cross-platform benchmark.

Tests should defend behaviors and boundaries. Include engine/schema tests and a focused end-to-end browser flow; do not substitute mocked model calls for the live-provider check.

## Repository and final handoff

Keep documentation compact: README with the demo first, installation and no-key/live-AI setup; one architecture/law-format explanation; concise limits and attribution. Include a compatible open-source license, an environment example without secrets, meaningful CI, sample experiments, and a short useful AGENTS.md. The install must work from a clean clone without your unpublished files or private tooling.

Before publication, check source, assets, history, examples, and logs for credentials and private machine data. Record useful AI assistance and upstream reuse honestly. Do not fabricate commits, stars, badges, benchmark results, or endorsements.

Finish with the repository/PR link, exact reviewed commit, commands actually run and their results, visible demo evidence, live-provider proof status, supported limits, and the shortest user run path. Distinguish source, local runtime, public deployment, and release status. Publish a preview or release only through an authorized existing owner route; an unconfigured host must not become an invented deployment claim. Stop only with a working reviewable result or a specific external blocker after completing the independent work.

## References to inspect, not runtime requirements

- [Rapier JavaScript determinism](https://rapier.rs/docs/user_guides/javascript/determinism/) explains initialization and engine-version conditions; the complete application still needs its own replay proof.
- [Rapier snapshots](https://rapier.rs/docs/user_guides/javascript/serialization/) cover physics-world restoration; include the application state described above.
- [Genie](https://deepmind.google/models/genie/) is related generative-world work. Acknowledge the relationship and describe Rulebreaker's actual contribution without claiming to reproduce that model.
