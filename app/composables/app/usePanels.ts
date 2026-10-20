/** Map editor dock layout (editor-only UI state, so localStorage). One shared instance: menus, status bar and editor toggle the same refs. */
export const usePanels = createGlobalState(() => {
    const state = useLocalStorage('neo-panels', {
        sidebar: true,
        inspector: true,
        bottom: true,
        bottomView: 'problems' as 'problems' | 'json',
        bottomHeight: 192,
    }, { mergeDefaults: true })
    const field = <K extends keyof typeof state.value>(key: K) => computed({
        get: () => state.value[key],
        set: (value) => { state.value[key] = value },
    })
    return {
        sidebar: field('sidebar'),
        inspector: field('inspector'),
        bottom: field('bottom'),
        bottomView: field('bottomView'),
        bottomHeight: field('bottomHeight'),
    }
})
