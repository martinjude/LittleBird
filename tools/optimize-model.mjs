#!/usr/bin/env node
/**
 * Model pipeline (PLAN.md §7).
 *
 *   npm run model -- inspect <file.gltf|glb>
 *       Prints the node tree, bounds, triangle counts and textures, and checks the
 *       naming conventions the game relies on (Rotor_Main, Eye_Pilot, ...).
 *
 *   npm run model -- build <in.gltf|glb> <out.glb> [--texture 2048] [--config prep.json]
 *       [prep] → dedup → prune → weld → resample → WebP textures (resized) → Meshopt compression.
 *       Output goes in public/models/ and is loaded with GLTFLoader + MeshoptDecoder.
 *
 *   The optional prep config brings a downloaded model to the conventions without Blender:
 *     { "flatten": true,                         collapse wrapper nodes (Sketchfab adds several)
 *       "rename": { "Object_15": "Rotor_Main" },  give the parts the names the game looks for
 *       "offset": [x, y, z],                      move the origin to the skid bottoms under the mast
 *       "addNodes": { "Eye_Pilot": [x, y, z] } }  empty marker nodes, in final coordinates
 */
import { readFileSync, statSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, flatten, getBounds, meshopt, prune, resample, textureCompress, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'

/** Node names the game looks for. `required` ones are needed for the helicopter to work properly. */
const CONVENTIONS = [
  { pattern: /^Rotor_Main$/, label: 'Rotor_Main', required: true, note: 'main rotor, pivot on the mast axis' },
  { pattern: /^Rotor_Tail$/, label: 'Rotor_Tail', required: true, note: 'tail rotor, pivot on its hub' },
  { pattern: /^Eye_Pilot$/, label: 'Eye_Pilot', required: false, note: 'cockpit camera position' },
  { pattern: /^Seat_\d+$/, label: 'Seat_01..06', required: false, note: 'troop seats' },
  { pattern: /^Muzzle_[LR]$/, label: 'Muzzle_L/R', required: false, note: 'minigun muzzles' },
  { pattern: /^Rocket_[LR]$/, label: 'Rocket_L/R', required: false, note: 'rocket pods' },
  { pattern: /^Skid_(FL|FR|RL|RR)$/, label: 'Skid_FL/FR/RL/RR', required: false, note: 'skid contact points' },
  { pattern: /^COL_/, label: 'COL_*', required: false, note: 'collision proxies' },
]

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

async function main() {
  const [command, input, output, ...rest] = process.argv.slice(2)
  if (!command || !input || (command === 'build' && !output) || !['inspect', 'build'].includes(command)) {
    console.log('Usage:\n  npm run model -- inspect <file>\n  npm run model -- build <in> <out.glb> [--texture 2048] [--config prep.json]')
    process.exit(1)
  }
  await MeshoptDecoder.ready
  await MeshoptEncoder.ready
  const doc = await io.read(input)

  if (command === 'inspect') {
    inspect(doc)
    return
  }

  const textureSize = Number(flag(rest, '--texture') ?? 2048)
  const configPath = flag(rest, '--config')
  const config = configPath ? JSON.parse(readFileSync(configPath, 'utf8')) : {}

  if (config.flatten) await doc.transform(flatten())
  for (const node of doc.getRoot().listNodes()) {
    const name = config.rename?.[node.getName()]
    if (name) node.setName(name)
  }
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  if (config.offset) {
    for (const node of scene.listChildren()) node.setTranslation(node.getTranslation().map((v, i) => v + config.offset[i]))
  }

  await doc.transform(dedup(), prune())
  // Markers are empty nodes, so add them after prune() (which drops empty leaves).
  for (const [name, position] of Object.entries(config.addNodes ?? {})) scene.addChild(doc.createNode(name).setTranslation(position))

  await doc.transform(
    weld(),
    resample(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureSize, textureSize], quality: 85 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  await io.write(output, doc)

  const before = statSync(input).size
  const after = statSync(output).size
  console.log(`\n${input} → ${output}`)
  console.log(`size: ${mb(before)} → ${mb(after)} (textures resized to ≤${textureSize}px, WebP; meshes Meshopt-compressed)`)
  console.log('Note: .gltf inputs keep their .bin/textures in separate files, so "before" understates them.')
}

function inspect(doc) {
  const root = doc.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  const b = getBounds(scene)
  const size = b.max.map((v, i) => v - b.min[i])
  console.log(`\nBounds (m): min [${b.min.map(f2)}]  max [${b.max.map(f2)}]  size [${size.map(f2)}]`)
  console.log('  Expected: Y up, nose toward +Z, skids at Y=0, ~9.4 m long incl. rotor, ~2.6 m tall.')

  let totalTris = 0
  const names = []
  console.log('\nNode tree:')
  const walk = (node, depth) => {
    const mesh = node.getMesh()
    const tris = mesh ? countTriangles(mesh) : 0
    totalTris += tris
    names.push(node.getName())
    const t = node.getTranslation().map(f2).join(', ')
    console.log(`${'  '.repeat(depth + 1)}${node.getName() || '(unnamed)'}${mesh ? `  [mesh, ${tris} tris]` : ''}  @ (${t})`)
    for (const child of node.listChildren()) walk(child, depth + 1)
  }
  for (const node of scene.listChildren()) walk(node, 0)
  console.log(`\nTriangles: ${totalTris.toLocaleString()}   Materials: ${root.listMaterials().length}   Animations: ${root.listAnimations().length}`)

  console.log('\nTextures:')
  for (const tex of root.listTextures()) {
    const dims = tex.getSize()
    console.log(`  ${tex.getName() || tex.getURI() || '(embedded)'}  ${dims ? dims.join('×') : '?'}  ${tex.getMimeType()}  ${kb(tex.getImage()?.byteLength ?? 0)}`)
  }

  console.log('\nConventions:')
  for (const c of CONVENTIONS) {
    const found = names.filter((n) => c.pattern.test(n))
    const mark = found.length ? '✓' : c.required ? '✗' : '–'
    console.log(`  ${mark} ${c.label.padEnd(18)} ${found.length ? found.join(', ') : `missing (${c.note})`}`)
  }
}

function countTriangles(mesh) {
  let n = 0
  for (const prim of mesh.listPrimitives()) {
    const indices = prim.getIndices()
    const position = prim.getAttribute('POSITION')
    n += Math.floor((indices ? indices.getCount() : (position?.getCount() ?? 0)) / 3)
  }
  return n
}

const flag = (args, name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const f2 = (v) => v.toFixed(2)
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
