import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import sample from './scene.json'
import { createSimulation } from './simulation'

export function World({ upward, onHeight }: { upward: boolean, onHeight: (value: number) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const apply = useRef<((up: boolean) => void) | null>(null)
  const current = useRef(upward)

  useEffect(() => {
    current.current = upward
    apply.current?.(upward)
  }, [upward])

  useEffect(() => {
    const container = host.current!
    let canceled = false
    let cleanup = () => {}
    createSimulation(sample).then(simulation => {
      if (canceled) { simulation.dispose(); return }
      cleanup = () => simulation.dispose()
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      cleanup = () => { renderer.dispose(); simulation.dispose() }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      const scene = new THREE.Scene()
      scene.background = new THREE.Color('#101d2b')
      const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100)
      camera.position.set(12, 9, 17)
      camera.lookAt(0, 4, 0)
      scene.add(new THREE.HemisphereLight(0xb7ddff, 0x263445, 3))
      const sun = new THREE.DirectionalLight(0xffffff, 3)
      sun.position.set(3, 12, 8)
      scene.add(sun, new THREE.GridHelper(16, 16, 0x40627a, 0x20394b))
      const ceiling = new THREE.GridHelper(16, 16, 0x40627a, 0x20394b)
      ceiling.position.y = 10
      scene.add(ceiling)
      const colors = { blue: '#73caff', red: '#ff7973', gold: '#ffc86e' }
      const meshes = simulation.scene.objects.map(object => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: colors[object.color], roughness: 0.3 }))
        scene.add(mesh)
        return { id: object.id, mesh }
      })
      renderer.domElement.setAttribute('aria-label', 'Live starter physics scene')
      container.replaceChildren(renderer.domElement)
      const resize = () => {
        const { width, height } = container.getBoundingClientRect()
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
      }
      const observer = new ResizeObserver(resize)
      observer.observe(container)
      resize()
      apply.current = up => simulation.apply({ schema: 'rulebreaker/law/v1', operation: 'set-gravity-scale', targets: ['blue-a', 'blue-b'], scale: up ? -1 : 1 })
      apply.current(current.current)
      let frame = 0
      let previous = performance.now()
      let accumulator = 0
      let ticks = 0
      const animate = (now: number) => {
        accumulator += Math.min((now - previous) / 1000, 0.1)
        previous = now
        while (accumulator >= 1 / 60) {
          simulation.step()
          accumulator -= 1 / 60
          if (++ticks % 12 === 0) onHeight(simulation.bodies.get('blue-a')!.translation().y)
        }
        for (const { id, mesh } of meshes) {
          const body = simulation.bodies.get(id)!
          const position = body.translation()
          const rotation = body.rotation()
          mesh.position.set(position.x, position.y, position.z)
          mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
        }
        renderer.render(scene, camera)
        frame = requestAnimationFrame(animate)
      }
      frame = requestAnimationFrame(animate)
      cleanup = () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        apply.current = null
        simulation.dispose()
        for (const { mesh } of meshes) { mesh.geometry.dispose(); mesh.material.dispose() }
        renderer.dispose()
        container.replaceChildren()
      }
    }).catch(error => {
      cleanup()
      cleanup = () => {}
      if (!canceled) container.textContent = `Scene unavailable: ${error instanceof Error ? error.message : 'unknown error'}`
    })
    return () => { canceled = true; cleanup() }
  }, [onHeight])

  return <div className="world" ref={host} />
}
