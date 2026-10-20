import { Channel, invoke } from '@tauri-apps/api/core'

type BuildEvent = { kind: 'line', data: string } | { kind: 'exit', data: number | null }

export interface BuildRun {
    status: 'running' | 'succeeded' | 'failed'
    /** 'dotnet build' output lines, stdout and stderr interleaved */
    lines: string[]
    /** start-up failure (dotnet missing) or a non-zero exit summary */
    error: string | null
    startedAt: number
    finishedAt: number | null
}

const MAX_LINES = 5000

/**
 * "Refresh specs": `dotnet build` in the project root, so NeoGameLib regenerates Data/<Game>.neoschema.json with the
 * game's current specs. The schema watcher in useProject would pick the new file up too; reloading here makes the
 * result visible even when the build didn't change it.
 */
export function useBuild() {
    const run = useState<BuildRun | null>('neo-build', () => null)
    const logOpen = useState('neo-build-log', () => false)
    const project = useProject()
    const toast = useToast()

    const running = computed(() => run.value?.status === 'running')

    async function build() {
        const root = project.state.value?.root
        if (!root || running.value) return
        const current: BuildRun = reactive({ status: 'running', lines: [], error: null, startedAt: Date.now(), finishedAt: null })
        run.value = current
        const channel = new Channel<BuildEvent>()
        channel.onmessage = (event) => {
            if (event.kind === 'line') {
                current.lines.push(event.data)
                if (current.lines.length > MAX_LINES) current.lines.splice(0, current.lines.length - MAX_LINES)
                return
            }
            current.status = event.data === 0 ? 'succeeded' : 'failed'
            if (event.data !== 0) current.error = `dotnet build exited with code ${event.data ?? '(killed)'}`
        }
        try {
            await invoke('dotnet_build', { root, onEvent: channel })
        }
        catch (e) {
            current.status = 'failed'
            current.error = e instanceof Error ? e.message : String(e)
        }
        current.finishedAt = Date.now()

        if (current.status === 'succeeded') {
            await project.reloadSchema()
            const schema = project.state.value?.schema
            toast.add({
                title: 'Specs refreshed',
                description: schema ? `${schema['x-neo-specs']?.length ?? 0} specs · ${schema['x-neo-actions']?.length ?? 0} actions` : project.state.value?.schemaError ?? undefined,
                color: 'success',
                icon: 'i-lucide-check',
                duration: 2500,
            })
        }
        else {
            toast.add({
                title: 'Build failed',
                description: current.error ?? undefined,
                color: 'error',
                icon: 'i-lucide-hammer',
                actions: [{ label: 'Show log', color: 'neutral', variant: 'outline', onClick: () => { logOpen.value = true } }],
            })
        }
    }

    return { run, running, logOpen, build }
}
