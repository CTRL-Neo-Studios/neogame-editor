import { isTauri } from '@tauri-apps/api/core'
import { load } from '@tauri-apps/plugin-store'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import type { Update } from '@tauri-apps/plugin-updater'

/** Release channel + optional access token, persisted with tauri-plugin-store. */
export interface UpdateSettings {
    /** stable, beta (public) or insider, team (need a token from the studio) */
    channel: string
    token: string
}

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'error'

const DEFAULTS: UpdateSettings = { channel: 'stable', token: '' }

/**
 * App updates from https://www.ctrl-neo.dev/apps (endpoint + public key in tauri.conf.json). The channel and token
 * go out as X-Neo-* headers; the updater resends them when downloading, which presigned S3 URLs ignore.
 */
export function useUpdater() {
    const settings = useState<UpdateSettings>('neo-update-settings', () => ({ ...DEFAULTS }))
    const phase = useState<UpdatePhase>('neo-update-phase', () => 'idle')
    const available = useState<{ version: string, notes: string } | null>('neo-update-available', () => null)
    const progress = useState<number | null>('neo-update-progress', () => null)
    const error = useState<string | null>('neo-update-error', () => null)
    const dialogOpen = useState('neo-update-dialog', () => false)
    const supported = isTauri()

    const store = () => load('updates.json', { autoSave: true, defaults: { ...DEFAULTS } })

    async function loadSettings() {
        const s = await store()
        settings.value = {
            channel: (await s.get<string>('channel')) || DEFAULTS.channel,
            token: (await s.get<string>('token')) ?? '',
        }
    }

    async function saveSettings(next: UpdateSettings) {
        settings.value = { channel: next.channel.trim() || DEFAULTS.channel, token: next.token.trim() }
        const s = await store()
        await s.set('channel', settings.value.channel)
        await s.set('token', settings.value.token)
    }

    const headers = () => ({
        'X-Neo-Channel': settings.value.channel,
        ...(settings.value.token ? { 'X-Neo-Token': settings.value.token } : {}),
    })

    /** Asks the server; on a newer version, `available` is set. Returns the update handle (caller closes it). */
    async function fetchUpdate(): Promise<Update | null> {
        phase.value = 'checking'
        error.value = null
        try {
            const update = await check({ headers: headers(), timeout: 30_000 })
            available.value = update ? { version: update.version, notes: update.body ?? '' } : null
            phase.value = update ? 'available' : 'idle'
            return update
        }
        catch (e) {
            // 401/403 on restricted channels and network failures all land here
            error.value = e instanceof Error ? e.message : String(e)
            phase.value = 'error'
            return null
        }
    }

    /** Checks and releases the handle right away; install() checks again for a fresh download link. */
    async function checkNow() {
        if (!supported) return null
        const update = await fetchUpdate()
        await update?.close()
        return available.value
    }

    /**
     * Saves or discards open work (Windows quits the app on its own before installing), checks again so the
     * download link is fresh (they expire after 15 minutes), installs and relaunches.
     */
    async function install(confirmDiscard: () => Promise<boolean>) {
        if (!supported || !(await confirmDiscard())) return
        const update = await fetchUpdate()
        if (!update) return
        phase.value = 'downloading'
        progress.value = 0
        let total = 0
        let received = 0
        try {
            await update.downloadAndInstall((event) => {
                if (event.event === 'Started') total = event.data.contentLength ?? 0
                else if (event.event === 'Progress') {
                    received += event.data.chunkLength
                    progress.value = total ? Math.min(100, Math.round(received / total * 100)) : null
                }
            }, { headers: headers() })
            await relaunch()
        }
        catch (e) {
            error.value = e instanceof Error ? e.message : String(e)
            phase.value = 'error'
            await update.close()
        }
    }

    return { supported, settings, phase, available, progress, error, dialogOpen, loadSettings, saveSettings, checkNow, install }
}
