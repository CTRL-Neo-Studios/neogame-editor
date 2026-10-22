import type { ContextMenuItem } from '@nuxt/ui'

/**
 * One right-click menu over an area. Wrap the area in `<UContextMenu :items="menu.items" :content="menu.content">` and
 * give the wrapped element `data-context-menu @contextmenu.capture="menu.reset" @contextmenu="menu.settle"`; rows call
 * `menu.set(target)` from their own `@contextmenu`. The innermost row wins, no items = no menu at all, text fields keep
 * the browser's menu. Outside `[data-context-menu]` areas the layout blocks the browser menu in production builds.
 */
export function useContextTarget<T>(build: (target: T | null) => ContextMenuItem[] | ContextMenuItem[][]) {
    const target = shallowRef<T | null>(null)
    return reactive({
        items: computed(() => build(target.value)),
        // closing must not refocus the trigger: an action like Rename has just focused its own input
        content: { onCloseAutoFocus: (e: Event) => e.preventDefault() },
        set(t: T) {
            target.value ??= t
        },
        reset(e: MouseEvent) {
            target.value = null
            if ((e.target as Element).closest('input, textarea, [contenteditable="true"]')) e.stopPropagation()
        },
        // UContextMenu opens a tick later unless the event was prevented by then
        settle(e: MouseEvent) {
            if (!build(target.value).length) e.preventDefault()
        },
    })
}
