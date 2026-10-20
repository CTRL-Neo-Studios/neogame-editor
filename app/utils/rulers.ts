import type { Vec2 } from '#shared/types/neo'

export const RULER = 18 // px thickness of the top and left ruler strips (screen px)

export interface RulerOptions {
    width: number
    height: number /* canvas css px */
    zoom: number
    pan: { x: number, y: number } /* css px, world->screen = world*zoom + pan */
    cellSize: Vec2
    cols: number
    rows: number
    selection: { col: number, row: number, cols: number, rows: number } | null
    hover: { c: number, r: number } | null
    colors: { bg: string, tick: string, text: string, accent: string }
}

const STEPS = [1, 2, 5]
/** Smallest 1/2/5·10ⁿ cell step whose labels are ≥ 48 css px apart. */
function majorStep(cellPx: number) {
    for (let mag = 1; ; mag *= 10)
        for (const s of STEPS) if (s * mag * cellPx >= 48 || mag > 1e6) return s * mag
}

/** Pure canvas drawing; ctx transform must be identity scaled by devicePixelRatio (css px units). */
export function drawRulers(ctx: CanvasRenderingContext2D, o: RulerOptions): void {
    const { width: W, height: H, zoom, pan, cellSize, colors } = o
    const cwPx = cellSize.x * zoom, chPx = cellSize.y * zoom
    const sx = (c: number) => c * cwPx + pan.x
    const sy = (r: number) => r * chPx + pan.y

    ctx.save()
    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, W, RULER)
    ctx.fillRect(0, 0, RULER, H)

    ctx.font = '10px system-ui'
    ctx.textBaseline = 'top'

    // selection bands under the ticks
    const sel = o.selection
    if (sel) {
        ctx.globalAlpha = 0.35
        ctx.fillStyle = colors.accent
        ctx.fillRect(sx(sel.col), 0, sel.cols * cwPx, RULER)
        ctx.fillRect(0, sy(sel.row), RULER, sel.rows * chPx)
        ctx.globalAlpha = 1
    }

    // ticks: top strip
    ctx.beginPath()
    ctx.strokeStyle = colors.tick
    ctx.fillStyle = colors.text
    ctx.lineWidth = 1
    const stepX = majorStep(cwPx)
    const c0 = Math.max(0, Math.floor(-pan.x / cwPx)), c1 = Math.min(o.cols, Math.ceil((W - pan.x) / cwPx))
    const drawMinorX = cwPx >= 4
    for (let c = c0; c <= c1; c++) {
        const major = c % stepX === 0
        if (!major && !drawMinorX) continue
        const x = Math.round(sx(c)) + 0.5
        if (x < RULER) continue
        ctx.moveTo(x, major ? 0 : RULER - 4)
        ctx.lineTo(x, RULER)
        if (major) ctx.fillText(String(c * cellSize.x), x + 2, 2)
    }
    // ticks: left strip, labels rotated -90°
    const stepY = majorStep(chPx)
    const r0 = Math.max(0, Math.floor(-pan.y / chPx)), r1 = Math.min(o.rows, Math.ceil((H - pan.y) / chPx))
    const drawMinorY = chPx >= 4
    for (let r = r0; r <= r1; r++) {
        const major = r % stepY === 0
        if (!major && !drawMinorY) continue
        const y = Math.round(sy(r)) + 0.5
        if (y < RULER) continue
        ctx.moveTo(major ? 0 : RULER - 4, y)
        ctx.lineTo(RULER, y)
        if (major) {
            ctx.save()
            ctx.translate(2, y - 2)
            ctx.rotate(-Math.PI / 2)
            ctx.fillText(String(r * cellSize.y), 0, 0)
            ctx.restore()
        }
    }
    ctx.stroke()

    ctx.strokeStyle = colors.accent
    ctx.fillStyle = colors.text
    if (sel) {
        const xa = sx(sel.col), xb = sx(sel.col + sel.cols), ya = sy(sel.row), yb = sy(sel.row + sel.rows)
        ctx.beginPath()
        for (const x of [xa, xb]) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, RULER) }
        for (const y of [ya, yb]) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(RULER, Math.round(y) + 0.5) }
        ctx.stroke()

        const wPx = sel.cols * cellSize.x, hPx = sel.rows * cellSize.y
        const span = xb - xa
        let label = `${sel.cols}×${sel.rows} · ${wPx}×${hPx}px`
        if (ctx.measureText(label).width + 6 > span) label = `${wPx}px`
        const lw = ctx.measureText(label).width
        ctx.fillStyle = colors.bg
        ctx.fillRect((xa + xb - lw) / 2 - 2, 3, lw + 4, 12)
        ctx.fillStyle = colors.text
        ctx.fillText(label, (xa + xb - lw) / 2, 4)

        const rl = `${hPx}px`, rw = ctx.measureText(rl).width
        ctx.save()
        ctx.translate(3, (ya + yb + rw) / 2)
        ctx.rotate(-Math.PI / 2)
        ctx.fillStyle = colors.bg
        ctx.fillRect(-2, -1, rw + 4, 12)
        ctx.fillStyle = colors.text
        ctx.fillText(rl, 0, 0)
        ctx.restore()
    }

    if (o.hover) {
        ctx.fillStyle = colors.accent
        ctx.fillRect(sx(o.hover.c), RULER - 3, cwPx, 3)
        ctx.fillRect(RULER - 3, sy(o.hover.r), 3, chPx)
    }

    // inner border lines + corner square (on top, hides ticks/labels scrolled under it)
    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, RULER, RULER)
    ctx.strokeStyle = colors.tick
    ctx.beginPath()
    ctx.moveTo(0, RULER - 0.5); ctx.lineTo(W, RULER - 0.5)
    ctx.moveTo(RULER - 0.5, 0); ctx.lineTo(RULER - 0.5, H)
    ctx.stroke()
    ctx.restore()
}
