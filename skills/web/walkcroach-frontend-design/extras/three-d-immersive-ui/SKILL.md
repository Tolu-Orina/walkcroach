---
name: three-d-immersive-ui
description: World-class 3D and immersive UI design for React apps using React Three Fiber (Three.js) — when 3D is the right choice, performance and mobile optimization, camera/interaction accessibility, and integrating 3D elements into a normal React app shell. Use this skill whenever a build calls for 3D visuals, product configurators, hero scenes, WebGL effects, spatial/immersive interfaces, or "3D-based" UI, or when reviewing whether a 3D approach is appropriate for the brief.
---

# 3D & Immersive UI Design

3D on the web has moved from novelty to a standard, accessible tool via React Three Fiber (R3F) — a declarative React renderer over Three.js that lets 3D scenes be built with JSX, hooks, and normal component composition rather than imperative WebGL code. But the fact that it's accessible to build doesn't mean it's always the right choice: performance and usability depend entirely on implementation discipline, not on the technology itself.

## Decide if 3D is actually earning its place first

3D is a strong fit for: product configurators (see the actual product from every angle), data visualizations with genuine spatial structure, hero moments meant to be memorable and explorable, and dashboards visualizing 3D-native data (CAD, geospatial, architectural). It's a poor fit for ordinary content, forms, tables, or anything where a 3D treatment would slow the user down or add nothing beyond spectacle. If the content isn't actually spatial, a well-executed 2D/motion treatment (see framer-motion-micro-interactions) usually communicates faster and cheaper.

## Toolchain

- **React Three Fiber (R3F)** — the right choice for 3D inside a React app: native component model, hooks, JSX-based scenes, integrates with the rest of the app's state management. This is the default recommendation for any React/Next.js product.
- **@react-three/drei** — the standard companion library for R3F; provides common needs (controls, loaders, helpers, environment maps) so they don't need to be hand-rolled per project. Treat it as a near-default dependency alongside R3F.
- **Babylon.js** — consider instead of R3F for projects needing advanced physics simulation or complex realistic material behavior beyond what R3F/Three.js comfortably handles, or for non-React environments.
- **Spline** — appropriate for design-led teams that need to produce 3D scenes visually without hand-coding geometry; export into the R3F app rather than hand-authoring every scene from scratch when the team is design- rather than graphics-programming-led.

## The React shell stays React

The 3D scene is a subtree, not the whole app. Filters, navigation, pricing panels, forms, and checkout stay as normal React/Tailwind/shadcn components; only the parts that are genuinely spatial (the model, the configurator viewport) become a `<Canvas>` region. Selected state (color, material, camera target) should flow into the scene as props/state, not be managed imperatively inside the 3D layer disconnected from the rest of the app.

## Performance — the discipline that actually determines quality

- **Minimize draw calls.** Hundreds of unique meshes sent to the GPU individually is the single most common R3F performance failure. Use instancing (`InstancedMesh` / drei's `<Instances>`) wherever many similar objects repeat.
- **Track render/draw calls directly** during development (R3F's performance stats) rather than guessing from frame rate alone — draw call count is the leading indicator of where performance problems will emerge as a scene grows.
- **Mobile needs aggressive, not proportional, optimization**: reduce polygon counts 50–75% versus desktop, use texture compression, implement LOD (level-of-detail) systems that swap in simpler geometry at distance, and enable adaptive quality scaling based on device capability — treat mobile as a different performance budget, not a scaled-down version of the same one.
- **Always test on real devices**, not emulators — emulated GPU performance does not reliably predict real mobile WebGL performance.

## Camera and interaction accessibility

- Provide intuitive default camera controls (`OrbitControls` from drei is the standard starting point) but always provide an alternative, non-mouse-drag way to navigate for users who can't perform click-drag rotation — keyboard-driven camera presets or simple prev/next view buttons at minimum.
- Don't gate essential product information behind a required 3D interaction — if a user can't or won't rotate the model, critical details (specs, materials, dimensions) should still be reachable through ordinary UI, not exclusively through manipulating the scene.
- Respect `prefers-reduced-motion` for any auto-rotating or continuously animated 3D scene — provide a static initial frame instead of forced continuous motion.

## Loading and fallback states (ties to state-coverage-edge-cases)

3D assets (models, textures) are typically much heavier than ordinary page assets. Always show a loading state for the canvas (a skeleton or progress indicator, not a blank frame) via drei's `<Loader>` or an equivalent suspense boundary, and provide a static image or simplified fallback for browsers/devices without WebGL support rather than a broken or blank canvas.

## Pre-ship checklist
- [ ] The decision to use 3D was deliberate — the content is genuinely spatial, not decoration reaching for "world-class" without a functional reason
- [ ] React Three Fiber + drei is the default stack for React apps; Babylon.js/Spline chosen only for a specific stated reason (physics, non-React, design-led workflow)
- [ ] The rest of the app (nav, forms, filters) remains normal React components; the 3D canvas is a bounded subtree
- [ ] Draw calls were checked during development, with instancing used for repeated geometry
- [ ] Mobile has its own reduced-polygon, compressed-texture, LOD-enabled asset path — not just a scaled-down desktop scene
- [ ] A non-drag camera navigation option exists, and no essential product information is locked behind required 3D manipulation
- [ ] Auto-rotation/continuous motion respects `prefers-reduced-motion`
- [ ] A loading state and a no-WebGL fallback both exist — the canvas never shows blank
