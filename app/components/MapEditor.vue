<script setup lang="ts">
import type { Problem } from '~/utils/problems'

const props = defineProps<{ tab: MapTab }>()
const $t = useAppTabs()
const project = useProject()
const { sidebar, inspector, bottom, bottomView, bottomHeight } = usePanels()

const schema = computed(() => project.state.value?.schema ?? null)
const prefabs = computed(() => $t.prefabsOf(props.tab))

const problems = ref<Problem[]>([])
const json = ref('')
const errors = computed(() => problems.value.filter(p => p.level === 'error').length)

// validation compiles and walks the whole map, so batch rapid edits (a brush stroke) into one pass
watchDebounced(() => [props.tab.map, prefabs.value, project.state.value], () => {
    const state = project.state.value
    try {
        json.value = stringify(toMapFile(props.tab.map))
        problems.value = state ? mapProblems(props.tab, prefabs.value, state) : []
    }
    catch (e) {
        problems.value = [{ level: 'error', message: e instanceof Error ? e.message : String(e), where: props.tab.name, target: { kind: 'map' } }]
    }
}, { debounce: 250, deep: true, immediate: true })

const left = reactive(useResizable('neo-sidebar', { side: 'left', minSize: 180, maxSize: 480, defaultSize: 240, unit: 'px', storage: 'local', collapsible: true }))
const right = reactive(useResizable('neo-inspector', { side: 'right', minSize: 260, maxSize: 640, defaultSize: 320, unit: 'px', storage: 'local', collapsible: true }))
// dragging a side panel past its minimum hides it: same toggle as the View menu / status bar; uncollapsing restores its width for next time
watch(() => left.isCollapsed, (c) => { if (c) { left.collapse(false); sidebar.value = false } }, { immediate: true })
watch(() => right.isCollapsed, (c) => { if (c) { right.collapse(false); inspector.value = false } }, { immediate: true })

const root = ref<HTMLElement>()
const bottomDragging = ref(false)
function resizeBottom(e: PointerEvent) {
    const handle = e.currentTarget as HTMLElement
    const startY = e.clientY
    const startHeight = bottomHeight.value
    const max = (root.value?.clientHeight ?? 0) * 0.7
    const move = (ev: PointerEvent) => bottomHeight.value = Math.round(Math.min(max, Math.max(96, startHeight + startY - ev.clientY)))
    const up = () => {
        bottomDragging.value = false
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', up)
    }
    handle.setPointerCapture(e.pointerId)
    bottomDragging.value = true
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
}
</script>

<template>
    <div ref="root" class="flex h-full min-h-0 flex-col">
        <MapToolbar :tab="tab" :prefabs="prefabs" />

        <div class="flex min-h-0 flex-1">
            <div v-if="sidebar" :ref="el => left.el = el as HTMLElement" class="relative flex shrink-0 border-e border-default" :style="{ width: `${left.size}px` }">
                <MapSidebar :tab="tab" :prefabs="prefabs" class="min-w-0 flex-1" />
                <div
                    role="separator"
                    class="group absolute inset-y-0 -end-0.5 z-10 flex w-1 cursor-col-resize justify-center"
                    @mousedown="left.onMouseDown"
                    @touchstart="left.onTouchStart"
                    @dblclick="left.onDoubleClick"
                >
                    <div class="w-px transition-colors group-hover:bg-primary" :class="left.isDragging && 'bg-primary'" />
                </div>
            </div>

            <div class="relative min-w-0 flex-1">
                <MapCanvas v-if="schema" :tab="tab" :prefabs="prefabs" :schema="schema" class="absolute inset-0" />
                <div v-else class="flex h-full items-center justify-center">
                    <UEmpty icon="i-lucide-file-x" title="No schema" description="Build the game once so NeoGameLib writes Data/<Game>.neoschema.json.">
                        <template #actions>
                            <RefreshSpecsButton />
                        </template>
                    </UEmpty>
                </div>
            </div>

            <div v-if="inspector" :ref="el => right.el = el as HTMLElement" class="relative flex shrink-0 border-s border-default" :style="{ width: `${right.size}px` }">
                <MapInspector :tab="tab" :prefabs="prefabs" class="min-w-0 flex-1" />
                <div
                    role="separator"
                    class="group absolute inset-y-0 -start-0.5 z-10 flex w-1 cursor-col-resize justify-center"
                    @mousedown="right.onMouseDown"
                    @touchstart="right.onTouchStart"
                    @dblclick="right.onDoubleClick"
                >
                    <div class="w-px transition-colors group-hover:bg-primary" :class="right.isDragging && 'bg-primary'" />
                </div>
            </div>
        </div>

        <div v-if="bottom" class="relative flex max-h-[70%] min-h-24 shrink-0 flex-col border-t border-default" :style="{ height: `${bottomHeight}px` }">
            <div
                role="separator"
                class="group absolute inset-x-0 -top-0.5 z-10 flex h-1 cursor-row-resize flex-col justify-center touch-none"
                @pointerdown="resizeBottom"
            >
                <div class="h-px transition-colors group-hover:bg-primary" :class="bottomDragging && 'bg-primary'" />
            </div>
            <ProblemsPanel :tab="tab" :problems="problems" :json="json" :view="bottomView" class="min-h-0 flex-1" />
        </div>

        <StatusBar :errors="errors" :warnings="problems.length - errors" />
    </div>
</template>
