// Small pure helpers shared by MapCanvas.vue. No Pixi imports here so the file stays testable and lean.

/** Convert a CSS color ('#rgb' / '#rrggbb' / '#rrggbbaa' / 'rgb(r g b)' / 'black') to a 0xRRGGBB number Pixi accepts. */
export function parseHexColor(color: string): number {
    const value = color.trim()
    if (value.startsWith('rgb')) {
        const match = value.match(/[\d.]+/g)
        if (match && match.length >= 3)
            return (Number.parseInt(match[0]!) << 16) | (Number.parseInt(match[1]!) << 8) | Number.parseInt(match[2]!)
        return 0
    }
    if (/^[a-z]+$/i.test(value)) return COLOR_NAMES[value.toLowerCase()] ?? 0
    let h = value
    if (h.startsWith('#')) h = h.slice(1)
    if (h.length === 3) h = h[0]! + h[0] + h[1]! + h[1] + h[2]! + h[2]
    if (h.length === 4) h = h[0]! + h[0] + h[1]! + h[1] + h[2]! + h[2]
    const parsed = Number.parseInt(h.slice(0, 6), 16)
    return Number.isFinite(parsed) ? parsed : 0
}

const COLOR_NAMES: Record<string, number> = {
    black: 0x000000,
    white: 0xffffff,
    red: 0xff0000,
    green: 0x008000,
    blue: 0x0000ff,
    gray: 0x808080,
    grey: 0x808080,
    transparent: 0x000000,
}

/** Deterministic fallback color for a prefab while its preview texture is missing/unavailable. */
export function colorOf(name: string | null, textureName: string | null): string {
    if (!name) return '#ff00ff'
    const seed = textureName ?? name
    let hash = 0
    for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
    return `hsl(${hash % 360} 38% 45%)`
}

/** Every map cell a world-space segment from `a` to `b` passes through (DDA/Bresenham in cell space). */
export function cellsAlongLine(a: { x: number, y: number }, b: { x: number, y: number }, cell: { x: number, y: number }): { c: number, r: number }[] {
    let c0 = Math.floor(a.x / cell.x)
    let r0 = Math.floor(a.y / cell.y)
    const c1 = Math.floor(b.x / cell.x)
    const r1 = Math.floor(b.y / cell.y)

    const seen = new Set<string>()
    const push = (c: number, r: number) => {
        const key = `${c},${r}`
        if (!seen.has(key)) {
            seen.add(key)
            out.push({ c, r })
        }
    }
    const out: { c: number, r: number }[] = []
    push(c0, r0)

    const dc = Math.abs(c1 - c0)
    const dr = Math.abs(r1 - r0)
    const sc = c0 < c1 ? 1 : -1
    const sr = r0 < r1 ? 1 : -1
    let err = dc - dr

    while (c0 !== c1 || r0 !== r1) {
        const e2 = 2 * err
        if (e2 > -dr) { err -= dr; c0 += sc }
        if (e2 < dc) { err += dc; r0 += sr }
        push(c0, r0)
    }
    return out
}
