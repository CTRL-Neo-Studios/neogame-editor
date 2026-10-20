// Name rules from NeoGameLib 0.4.1 NeoMapping/NeoNames.cs. The runtime throws on violations, so the editor blocks
// them at input time and reports hand-edited files in the Problems panel.

// path names (maps, prefab libraries and their folders) are file paths and must work on every OS
const SEGMENT = /^[A-Za-z0-9_-]([A-Za-z0-9 ._-]*[A-Za-z0-9_-])?$/
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
// key names (prefabs, collider groups, prefab folder segments) are dictionary keys that never touch the disk
const CONTROL = /[\u0000-\u001f\u007f]/

/** Why `name` can't be one path segment (a folder or file name), or null when it can. */
export function segmentError(segment: string): string | null {
    if (!segment) return 'empty name'
    if (segment === '.' || segment === '..') return `'${segment}' is not allowed`
    if (RESERVED.test(segment)) return `'${segment}' is a reserved Windows device name`
    if (!SEGMENT.test(segment)) {
        if (/[^\x20-\x7e]/.test(segment)) return 'only ASCII letters, digits, _ - . and spaces are allowed'
        if (/^[ .]|[ .]$/.test(segment)) return 'can\'t start or end with a space or dot'
        return 'only letters, digits, _ - . and spaces are allowed'
    }
    return null
}

/** Why `name` can't be a map/library name (`forest/level1`), or null when it can. */
export function pathNameError(name: string): string | null {
    if (!name) return 'name is required'
    if (name.includes('\\')) return 'use / to separate folders'
    if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) return 'empty folder name'
    for (const segment of name.split('/')) {
        const error = segmentError(segment)
        if (error) return name.includes('/') ? `'${segment}': ${error}` : error
    }
    return null
}

/** Why `name` can't be a prefab/collider-group key or a prefab folder segment, or null when it can. */
export function keyNameError(name: string): string | null {
    if (!name) return 'name is required'
    if (name.includes('/')) return `'/' is reserved for folders; put '${name.split('/')[0]}' in a folder instead`
    if (CONTROL.test(name)) return 'control characters are not allowed'
    if (name !== name.trim()) return 'no leading or trailing spaces'
    return null
}

/** Why `folder` can't be a prefab `folder` value (`terrain/slabs`, "" = root), or null when it can. */
export function folderError(folder: string): string | null {
    if (!folder) return null
    for (const segment of folder.split('/')) {
        if (!segment) return 'empty folder name'
        const error = keyNameError(segment)
        if (error) return error
    }
    return null
}

/**
 * The existing name `name` collides with, skipping `self` (the name being renamed). Case-insensitive: `Level1` and
 * `level1` are one file on Windows/macOS but two on Linux.
 */
export function pathCollision(names: Iterable<string>, name: string, self?: string): string | undefined {
    const lower = name.toLowerCase()
    for (const existing of names) if (existing !== self && existing.toLowerCase() === lower) return existing
}

/** Folder part and leaf of a `/`-separated name: `forest/level1` -> ['forest', 'level1']. */
export function splitName(name: string): [folder: string, leaf: string] {
    const i = name.lastIndexOf('/')
    return i < 0 ? ['', name] : [name.slice(0, i), name.slice(i + 1)]
}

export const joinName = (folder: string, leaf: string) => folder ? `${folder}/${leaf}` : leaf

/** Every folder prefix of the given names: `a/b/c` -> `a`, `a/b`. Sorted. */
export function foldersOf(names: Iterable<string>): string[] {
    const out = new Set<string>()
    for (const name of names) {
        const parts = name.split('/')
        for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/'))
    }
    return [...out].sort()
}

/** Action types whose `world` (and SwitchWorldAction's `unload[]`) are map names loaded through NeoProject.DataPath. */
export const WORLD_ACTIONS: Record<string, true> = { SwitchWorldAction: true, LoadWorldAction: true, UnloadWorldAction: true }

/** Whether an action entry's field holds map names (`unload` exists only on SwitchWorldAction). */
export const isWorldField = (actionType: string, field: string) =>
    !!WORLD_ACTIONS[actionType] && (field === 'world' || (field === 'unload' && actionType === 'SwitchWorldAction'))
