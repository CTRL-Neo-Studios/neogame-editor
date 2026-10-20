/** Whether keyboard focus is in a text field, so app shortcuts must leave the keys to it. */
export function isTyping(): boolean {
    const el = document.activeElement
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)
}

// Small pure helpers shared by MapCanvas.vue.

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
