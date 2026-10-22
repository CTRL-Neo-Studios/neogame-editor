// Runnable check for mergeColliders' runtime parity (NEOGAMELIB-PARITY §2): `bun app/utils/mapModel.check.ts`
import { type EditorMap, mergeColliders } from './mapModel'

const eq = (actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const map = (rows: string[]): EditorMap => ({
    cellSize: { x: 16, y: 16 }, origin: { x: 0, y: 0 }, libraries: [], cols: rows[0]!.length, rows: rows.length, objects: [], chars: {},
    layers: [{ name: 'main', visible: true, cells: rows.flatMap(r => [...r].map(ch => ({ U: 'up', F: 'full', T: 'trig' } as Record<string, string>)[ch] ?? null)) }],
})
const prefabs = { up: { collider: 'Upper' }, full: { collider: 'Full' }, trig: { collider: 'Trig' } }
const box = (sx: number, sy: number, oy: number, isTrigger = false) => ({ type: 'BoxColliderSpec', properties: { size: { x: sx, y: sy }, offset: { x: 0, y: oy }, isTrigger } })
const groups = { Upper: { specs: [box(16, 8, -4)] }, Full: { specs: [] }, Trig: { specs: [box(16, 16, 0, true), { type: 'TagSpec' }] } }

// 16x8 slabs: a 3x2 block merges along x only, one strip per row, each 8px tall in the cells' upper half
const slabs = mergeColliders(map(['UUU', 'UUU']), prefabs, groups)
eq(slabs.map(b => [b.col, b.row, b.width, b.height]), [[0, 0, 3, 1], [0, 1, 3, 1]])
eq(slabs[1]!.shapes, [{ x: 0, y: 16, w: 48, h: 8, trigger: false }])

// no BoxColliderSpec = one full-cell box per cell, merged both ways into one run
const full = mergeColliders(map(['FF', 'FF']), prefabs, groups)
eq(full.map(b => [b.width, b.height, b.shapes]), [[2, 2, [{ x: 0, y: 0, w: 32, h: 32, trigger: false }]]])

// isTrigger carries over; non-box group specs don't add shapes
const trig = mergeColliders(map(['T.T']), prefabs, groups)
eq(trig.map(b => b.shapes), [[{ x: 0, y: 0, w: 16, h: 16, trigger: true }], [{ x: 32, y: 0, w: 16, h: 16, trigger: true }]])

console.log('mergeColliders: ok')
