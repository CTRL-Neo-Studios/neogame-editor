import type { ProjectState } from '~/composables/project/useProject'

/**
 * Every kind of project document the editor lists, opens and edits: where its files live under Data/, their
 * extension and how the UI names them. Adding a kind = an entry here, and its file handling comes for free (project
 * scan, home-page panel with folders, create/rename/move/delete); then give it a tab (useAppTabs.open) and an
 * editor (EDITORS in pages/tabs/[tabId].vue).
 */
export type DocKind = 'map' | 'library'

export interface DocKindInfo {
    /** folder under Data/; subfolders are part of the name (`forest/level1`) */
    dir: string
    ext: string
    title: string
    noun: string
    nouns: string
    icon: string
    /** shown when the folder is empty */
    empty: string
    /** contents of a newly created file */
    blank: (project: ProjectState) => unknown
}

export const DOC_KINDS: Record<DocKind, DocKindInfo> = {
    map: {
        dir: 'NeoMaps', ext: '.neomap.json', title: 'Maps', noun: 'map', nouns: 'maps', icon: 'i-lucide-map',
        empty: 'Maps are saved under Data/NeoMaps.',
        blank: p => ({
            cellSize: { x: 32, y: 32 },
            prefabs: Object.keys(p.libraries).slice(0, 1),
            layers: [{ name: 'main', legend: { ' ': null }, rows: Array.from({ length: 12 }, () => ' '.repeat(16)) }],
            objects: [],
        }),
    },
    library: {
        dir: 'NeoPrefabs', ext: '.neoprefabs.json', title: 'Prefab libraries', noun: 'library', nouns: 'libraries', icon: 'i-lucide-boxes',
        empty: 'Prefab libraries are saved under Data/NeoPrefabs.',
        blank: () => ({ prefabs: {}, colliders: {} }),
    },
}

/** registry order: the home page shows panels in this order */
export const DOC_KIND_LIST = Object.keys(DOC_KINDS) as DocKind[]

/** The kind whose extension `path` ends with, if any. */
export const docKindOf = (path: string) => DOC_KIND_LIST.find(k => path.endsWith(DOC_KINDS[k].ext))
