import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import sample from './scene.json'
import { createSimulation } from './simulation'
import type { SimulationEvent } from './simulation'

type FreezeRequest = { id: string; nonce: number } | null

type WorldProps = {
  upward: boolean
  collisionNotes: boolean
  freezeOnClick: boolean
  freezeRequest: FreezeRequest
  selectedId: string | null
  onHeight: (value: number) => void
  onSelected: (id: string) => void
  onEvent: (event: SimulationEvent) => void
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

  const { upward, collisionNotes, freezeRequest, onEvent } = props

  useEffect(() => {
    propsRef.current = props
    selectedRef.current = props.selectedId
  }, [props])

  useEffect(() => {
    const simulation = simulationRef.current
    if (!simulation) return
    const blueTargets = simulation.scene.objects.filter(object => object.color === 'blue').map(object => object.id)
    const allTargets = simulation.scene.objects.map(object => object.id)
    simulation.apply(BLUE_GRAVITY(blueTargets, upward))
    if (collisionNotes) simulation.apply(COLLISION_NOTES(allTargets))
    else simulation.clearCollisionNoteLaw()
    if (freezeRequest && freezeRequest.nonce !== lastFreezeNonce.current) {
      lastFreezeNonce.current = freezeRequest.nonce
      for (const event of simulation.apply(FREEZE(freezeRequest.id))) onEvent(event)
    }
  }, [upward, collisionNotes, freezeRequest, onEvent])

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
      camera.position.set(12, 8.5, 16)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.08
      controls.minDistance = 7
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
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), material)
        mesh.userData.objectId = object.id
        scene.add(mesh)
        return { id: object.id, mesh, material }
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
          for (const eventItem of simulation.apply(FREEZE(id))) current.onEvent(eventItem)
        }
      }
      renderer.domElement.addEventListener('pointerdown', handlePointerDown)
      renderer.domElement.addEventListener('pointerup', handlePointerUp)

      let frame = 0
      let previous = performance.now()
      let accumulator = 0
      let sampleTicks = 0
      const animate = (now: number) => {
        accumulator += Math.min((now - previous) / 1000, 0.1)
        previous = now
        while (accumulator >= 1 / 60) {
          const events = simulation.step()
          for (const event of events) propsRef.current.onEvent(event)
          accumulator -= 1 / 60
          if (++sampleTicks % 12 === 0) propsRef.current.onHeight(simulation.bodies.get('blue-a')!.translation().y)
        }
        for (const { id, mesh, material } of meshes) {
          const body = simulation.bodies.get(id)!
          const position = body.translation()
          const rotation = body.rotation()
          mesh.position.set(position.x, position.y, position.z)
          mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
          const selected = selectedRef.current === id
          mesh.scale.setScalar(selected ? 1.12 : 1)
          material.emissiveIntensity = selected ? 0.4 : 0.06
        }
        controls.update()
        renderer.render(scene, camera)
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
