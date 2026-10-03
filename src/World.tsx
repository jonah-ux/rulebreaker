import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import sample from './scene.json'
import { createSimulation } from './simulation'
import type { Experiment } from './domain'
import type { SimulationEvent } from './simulation'
import { summarizeRuntimeWindow } from './runtimeMetrics'
import type { RuntimeMetrics } from './runtimeMetrics'

export type { RuntimeMetrics } from './runtimeMetrics'

type FreezeRequest = { id: string; nonce: number } | null
type HistoryAction = { type: 'undo' | 'save-branch' | 'restore-branch'; nonce: number } | null
type ExportRequest = { nonce: number } | null
type ImportRequest = { nonce: number; payload: string } | null
type LawRequest = { nonce: number; law: unknown } | null
type StepRequest = { nonce: number } | null
type RestoreResult = { ok: boolean; message: string }

type WorldProps = {
  upward: boolean
  collisionNotes: boolean
  freezeOnClick: boolean
  freezeRequest: FreezeRequest
  selectedId: string | null
  historyAction: HistoryAction
  exportRequest: ExportRequest
  importRequest: ImportRequest
  lawRequest: LawRequest
  paused: boolean
  stepRequest: StepRequest
  onHeight: (value: number) => void
  onSelected: (id: string) => void
  onEvent: (event: SimulationEvent) => void
  onHistoryState: (canUndo: boolean, hasBranch: boolean) => void
  onExport: (payload: string) => void
  onImportResult: (result: RestoreResult) => void
  onLawResult: (result: RestoreResult) => void
  onRestored: (snapshot: Experiment) => void
  onTick: (tick: number) => void
  onMetrics: (metrics: RuntimeMetrics) => void
}

const BLUE_GRAVITY = (targets: string[], upward: boolean) => ({
  schema: 'rulebreaker/law/v1' as const,
  operation: 'set-gravity-scale' as const,
  targets,
  scale: upward ? -1 : 1,
})

const COLLISION_NOTES = (targets: string[]) => ({
  schema: 'rulebreaker/law/v1' as const,
  operation: 'collision-note' as const,
  targets,
  threshold: 1.2,
  cooldownTicks: 24,
  maxVoices: 4,
})

const FREEZE = (target: string) => ({
  schema: 'rulebreaker/law/v1' as const,
  operation: 'temporary-freeze' as const,
  targets: [target],
  durationTicks: 180,
})

export function World(props: WorldProps) {
  const host = useRef<HTMLDivElement>(null)
  const simulationRef = useRef<Awaited<ReturnType<typeof createSimulation>> | null>(null)
  const propsRef = useRef(props)
  const selectedRef = useRef(props.selectedId)
  const lastFreezeNonce = useRef<number | null>(null)
  const historyRef = useRef<Experiment[]>([])
  const branchRef = useRef<Experiment | null>(null)
  const lastRuleStateRef = useRef({ upward: props.upward, collisionNotes: props.collisionNotes, freezeNonce: props.freezeRequest?.nonce ?? null })
  const suppressNextHistoryRef = useRef(false)
  const lastHistoryActionNonce = useRef<number | null>(null)
  const lastLawRequestNonce = useRef<number | null>(null)
  const lastExportNonce = useRef<number | null>(null)
  const lastImportNonce = useRef<number | null>(null)
  const readyRef = useRef(false)

  const { upward, collisionNotes, freezeRequest, historyAction, exportRequest, importRequest, lawRequest, onEvent } = props

  useEffect(() => {
    propsRef.current = props
    selectedRef.current = props.selectedId
  }, [props])

  useEffect(() => {
    const simulation = simulationRef.current
    const nextRuleState = { upward, collisionNotes, freezeNonce: freezeRequest?.nonce ?? null }
    const changed = nextRuleState.upward !== lastRuleStateRef.current.upward
      || nextRuleState.collisionNotes !== lastRuleStateRef.current.collisionNotes
      || nextRuleState.freezeNonce !== lastRuleStateRef.current.freezeNonce
    if (!changed) return
    lastRuleStateRef.current = nextRuleState
    if (!simulation) return
    if (readyRef.current && !suppressNextHistoryRef.current) {
      historyRef.current.push(simulation.snapshot(selectedRef.current))
      if (historyRef.current.length > 24) historyRef.current.shift()
      propsRef.current.onHistoryState(historyRef.current.length > 0, branchRef.current !== null)
    }
    suppressNextHistoryRef.current = false
    const blueTargets = simulation.scene.objects.filter(object => object.color === 'blue').map(object => object.id)
    const allTargets = simulation.scene.objects.map(object => object.id)
    simulation.apply(BLUE_GRAVITY(blueTargets, upward))
    if (collisionNotes) simulation.apply(COLLISION_NOTES(allTargets))
    else simulation.clearCollisionNoteLaw()
    if (freezeRequest && freezeRequest.nonce !== lastFreezeNonce.current) {
      lastFreezeNonce.current = freezeRequest.nonce
      for (const event of simulation.apply(FREEZE(freezeRequest.id))) propsRef.current.onEvent(event)
    }
  }, [upward, collisionNotes, freezeRequest, onEvent])

  useEffect(() => {
    const simulation = simulationRef.current
    if (!simulation) return
    const notifyHistory = () => propsRef.current.onHistoryState(historyRef.current.length > 0, branchRef.current !== null)
    const restoreSnapshot = (snapshot: Experiment) => {
      const restored = simulation.restore(snapshot)
      lastRuleStateRef.current = {
        upward: restored.bodies.filter(body => body.id.startsWith('blue-')).every(body => body.gravityScale === -1),
        collisionNotes: restored.collisionNoteLaw !== null,
        freezeNonce: null,
      }
      propsRef.current.onRestored(restored)
      suppressNextHistoryRef.current = false
      notifyHistory()
    }
    if (historyAction && historyAction.nonce !== lastHistoryActionNonce.current) {
      lastHistoryActionNonce.current = historyAction.nonce
      if (historyAction.type === 'undo') {
        const previous = historyRef.current.pop()
        if (previous) restoreSnapshot(previous)
        else notifyHistory()
      } else if (historyAction.type === 'save-branch') {
        branchRef.current = simulation.snapshot(selectedRef.current)
        notifyHistory()
      } else if (branchRef.current) {
        historyRef.current.push(simulation.snapshot(selectedRef.current))
        if (historyRef.current.length > 24) historyRef.current.shift()
        restoreSnapshot(branchRef.current)
      }
    }
    if (exportRequest && exportRequest.nonce !== lastExportNonce.current) {
      lastExportNonce.current = exportRequest.nonce
      propsRef.current.onExport(JSON.stringify(simulation.snapshot(selectedRef.current), null, 2))
    }
    if (importRequest && importRequest.nonce !== lastImportNonce.current) {
      lastImportNonce.current = importRequest.nonce
      try {
        const current = simulation.snapshot(selectedRef.current)
        const restored = simulation.restore(JSON.parse(importRequest.payload))
        historyRef.current.push(current)
        if (historyRef.current.length > 24) historyRef.current.shift()
        lastRuleStateRef.current = {
          upward: restored.bodies.filter(body => body.id.startsWith('blue-')).every(body => body.gravityScale === -1),
          collisionNotes: restored.collisionNoteLaw !== null,
          freezeNonce: null,
        }
        propsRef.current.onRestored(restored)
        suppressNextHistoryRef.current = false
        propsRef.current.onImportResult({ ok: true, message: 'Experiment imported into the live room.' })
        notifyHistory()
      } catch (error) {
        propsRef.current.onImportResult({ ok: false, message: error instanceof Error ? error.message : 'Experiment import was refused.' })
      }
    }
  }, [historyAction, exportRequest, importRequest])

  useEffect(() => {
    const simulation = simulationRef.current
    if (!simulation || !lawRequest || lawRequest.nonce === lastLawRequestNonce.current) return
    lastLawRequestNonce.current = lawRequest.nonce
    if (readyRef.current) {
      historyRef.current.push(simulation.snapshot(selectedRef.current))
      if (historyRef.current.length > 24) historyRef.current.shift()
    }
    try {
      for (const event of simulation.apply(lawRequest.law)) propsRef.current.onEvent(event)
      propsRef.current.onLawResult({ ok: true, message: 'Live proposal applied to the physics engine.' })
      propsRef.current.onHistoryState(historyRef.current.length > 0, branchRef.current !== null)
    } catch (error) {
      propsRef.current.onLawResult({ ok: false, message: error instanceof Error ? error.message : 'The live proposal was refused.' })
    }
  }, [lawRequest, onEvent])

  useEffect(() => {
    const container = host.current!
    let canceled = false
    let cleanup = () => {}

    createSimulation(sample).then(simulation => {
      if (canceled) {
        simulation.dispose()
        return
      }
      simulationRef.current = simulation
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.domElement.setAttribute('aria-label', 'Interactive Rulebreaker physics room. Drag to orbit, scroll to zoom, and click a shape to select it.')
      renderer.domElement.setAttribute('role', 'img')
      renderer.domElement.tabIndex = 0
      renderer.domElement.style.touchAction = 'none'

      const scene = new THREE.Scene()
      scene.background = new THREE.Color('#08131f')
      const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100)
      camera.position.set(9.5, 7, 12.5)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.08
      controls.minDistance = 5.5
      controls.maxDistance = 30
      controls.maxPolarAngle = Math.PI / 2.05
      controls.target.set(0, 4, 0)
      controls.update()

      scene.add(new THREE.HemisphereLight(0xc8e8ff, 0x172335, 2.7))
      const sun = new THREE.DirectionalLight(0xffffff, 3.2)
      sun.position.set(4, 12, 8)
      scene.add(sun)
      const floor = new THREE.GridHelper(16, 16, 0x4a7088, 0x1e3647)
      floor.position.y = 0
      const ceiling = new THREE.GridHelper(16, 16, 0x4a7088, 0x1e3647)
      ceiling.position.y = 10
      scene.add(floor, ceiling)

      const colors: Record<string, string> = { blue: '#65c7ff', red: '#ff756f', gold: '#ffc96c' }
      const meshes = simulation.scene.objects.map(object => {
        const material = new THREE.MeshStandardMaterial({
          color: colors[object.color],
          roughness: 0.28,
          metalness: 0.08,
          emissive: colors[object.color],
          emissiveIntensity: 0.06,
        })
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
        const haloMaterial = new THREE.MeshBasicMaterial({ color: colors[object.color], transparent: true, opacity: 0.8, wireframe: true })
        const halo = new THREE.Mesh(new THREE.SphereGeometry(0.78, 16, 12), haloMaterial)
        halo.visible = false
        mesh.userData.objectId = object.id
        scene.add(mesh, halo)
        return { id: object.id, mesh, material, halo, haloMaterial }
      })

      container.replaceChildren(renderer.domElement)
      const resize = () => {
        const { width, height } = container.getBoundingClientRect()
        renderer.setSize(Math.max(width, 1), Math.max(height, 1), false)
        camera.aspect = Math.max(width, 1) / Math.max(height, 1)
        camera.updateProjectionMatrix()
      }
      const observer = new ResizeObserver(resize)
      observer.observe(container)
      resize()

      const blueTargets = simulation.scene.objects.filter(object => object.color === 'blue').map(object => object.id)
      const allTargets = simulation.scene.objects.map(object => object.id)
      const applyCurrentRules = () => {
        const current = propsRef.current
        simulation.apply(BLUE_GRAVITY(blueTargets, current.upward))
        if (current.collisionNotes) simulation.apply(COLLISION_NOTES(allTargets))
        else simulation.clearCollisionNoteLaw()
        if (current.freezeRequest && current.freezeRequest.nonce !== lastFreezeNonce.current) {
          lastFreezeNonce.current = current.freezeRequest.nonce
          for (const event of simulation.apply(FREEZE(current.freezeRequest.id))) current.onEvent(event)
        }
      }
      applyCurrentRules()
      readyRef.current = true
      propsRef.current.onHistoryState(historyRef.current.length > 0, branchRef.current !== null)

      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()
      let pointerDown: { x: number; y: number } | null = null
      const handlePointerDown = (event: PointerEvent) => {
        if (event.button === 0) pointerDown = { x: event.clientX, y: event.clientY }
      }
      const handlePointerUp = (event: PointerEvent) => {
        if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 7) {
          pointerDown = null
          return
        }
        pointerDown = null
        const bounds = renderer.domElement.getBoundingClientRect()
        pointer.set(
          ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
        )
        raycaster.setFromCamera(pointer, camera)
        const hit = raycaster.intersectObjects(meshes.map(item => item.mesh), false)[0]
        const id = hit?.object.userData.objectId
        if (typeof id !== 'string') return
        const current = propsRef.current
        current.onSelected(id)
        if (current.freezeOnClick) {
          historyRef.current.push(simulation.snapshot(id))
          if (historyRef.current.length > 24) historyRef.current.shift()
          current.onHistoryState(historyRef.current.length > 0, branchRef.current !== null)
          for (const eventItem of simulation.apply(FREEZE(id))) current.onEvent(eventItem)
        }
      }
      renderer.domElement.addEventListener('pointerdown', handlePointerDown)
      renderer.domElement.addEventListener('pointerup', handlePointerUp)

      let frame = 0
      let previous = performance.now()
      let accumulator = 0
      let sampleTicks = 0
      let consumedStepNonce: number | null = null
      let metricWindowStartedAt = previous
      let metricFrameCount = 0
      let metricStartTick = simulation.tick
      const animate = (now: number) => {
        accumulator += Math.min((now - previous) / 1000, 0.1)
        previous = now
        const current = propsRef.current
        const requestedStep = current.stepRequest && current.stepRequest.nonce !== consumedStepNonce
        if (current.paused) {
          accumulator = 0
          if (requestedStep) {
            consumedStepNonce = current.stepRequest!.nonce
            const events = simulation.step()
            for (const event of events) current.onEvent(event)
            current.onTick(simulation.tick)
            current.onHeight(simulation.bodies.get('blue-a')!.translation().y)
          }
        } else {
          while (accumulator >= 1 / 60) {
            const events = simulation.step()
            for (const event of events) current.onEvent(event)
            current.onTick(simulation.tick)
            accumulator -= 1 / 60
            if (++sampleTicks % 12 === 0) current.onHeight(simulation.bodies.get('blue-a')!.translation().y)
          }
        }
        for (const { id, mesh, material, halo, haloMaterial } of meshes) {
          const body = simulation.bodies.get(id)!
          const position = body.translation()
          const rotation = body.rotation()
          mesh.position.set(position.x, position.y, position.z)
          mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
          halo.position.copy(mesh.position)
          halo.quaternion.copy(mesh.quaternion)
          const selected = selectedRef.current === id
          const inverted = body.gravityScale() < 0
          const frozen = !body.isMoving()
          mesh.scale.setScalar(selected ? 1.12 : 1)
          halo.visible = selected
          halo.scale.setScalar(selected ? 1.16 : 1)
          haloMaterial.opacity = selected ? 0.78 : 0
          material.emissiveIntensity = selected ? 0.4 : inverted ? 0.22 : frozen ? 0.16 : 0.06
        }
        controls.update()
        renderer.render(scene, camera)
        metricFrameCount += 1
        const metricElapsedMs = now - metricWindowStartedAt
        if (metricElapsedMs >= 500) {
          current.onMetrics(summarizeRuntimeWindow({
            elapsedMs: metricElapsedMs,
            frameCount: metricFrameCount,
            tickDelta: simulation.tick - metricStartTick,
            drawCalls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            geometries: renderer.info.memory.geometries,
            textures: renderer.info.memory.textures,
            pixelRatio: renderer.getPixelRatio(),
            objectCount: simulation.bodies.size,
          }))
          metricWindowStartedAt = now
          metricFrameCount = 0
          metricStartTick = simulation.tick
        }
        frame = requestAnimationFrame(animate)
      }
      frame = requestAnimationFrame(animate)
      cleanup = () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
        renderer.domElement.removeEventListener('pointerup', handlePointerUp)
        controls.dispose()
        simulationRef.current = null
        simulation.dispose()
        for (const { mesh } of meshes) {
          mesh.geometry.dispose()
          mesh.material.dispose()
        }
        renderer.dispose()
        container.replaceChildren()
      }
    }).catch(error => {
      cleanup()
      cleanup = () => {}
      if (!canceled) container.textContent = `Scene unavailable: ${error instanceof Error ? error.message : 'unknown error'}`
    })

    return () => {
      canceled = true
      cleanup()
    }
  }, [])

  return <div className="world" ref={host} />
}
