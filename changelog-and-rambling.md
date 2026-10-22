this is going to be the same as the instructions.md file in NeoGameLib

# Road to 0.1 - Foundations & QoL

## [0.1.0] Foundations

- Map editing
- Editor-like interface
- Basic functionality
- Shorcuts
- Smooth Project Open functionality

## [0.1.1, 0.1.2, 0.1.3, 0.1.4] UX/DX QoL Improvements (And a Damn Lot of Them)

### 1. Prefab Folders

I have a lot of prefabs in one map prefab file, and there needs to be folders that allows me to organize my prefabs and stuff into folders.

### 2. Better Collider Rendering

Better collider rendering. In `0.1.0`, every collider is rendered as a red outline with a small overlay on the actual tile in the map-editor. However, I have use cases that some tiles that are "slabs": i.e. 16x16px sprites with a 16x8px collider box, either offset at y=4 for lower or y=-4 for upper. (btw, in NeoGameLib, down & right = positive, up & left = negative)

### 3. Move/Select Tools

In `0.1.0` there is a "select" tool which doesn't do anything. I added an area selection tool that allows users to create selection of tiles, similar to pixel art editor selection. Users can drag an area, or if they missed an area after making a selection, they could shift+select to add to the current selection; or ctrl+select to remove from current selection.

After selecting, users have the option as shortcuts to either delete/copy/paste/cut the selected tiles. Which, on paste, the intuitive default action would be moving the pasted selection. Or, if they're not pasting, but right after making a selection, the editor switchs to a move tool that moves the selection to where-ever they want.

Also, the original paint-selected-area tool is updated with a new and more intuitive icon.

### 4.Map Grid sizing indicators

When editing, the size of your selection, and the size of which cell is now shown on the edge of the map editing view.

### 5. Resizable Panels & Panel-tool-bar

I use Zed a lot.

Resizable panels as in: I can drag the edge of the inspector panel and resize it to a smaller size; or the left sidebar, or the bottom problems/json-preview panel. And the panel-tool-bar like that of a Zed IDE bottom-bar where it's like h-4 or smth height, and has small icons that toggles the panels.

### 6. Better Prefab Library UI

The specs renders as a single column in the prefab library in `0.1.0`, which makes the UI cards of the specs stretched out, and it doesn't look good. Now it is a grid.

Even better, the Prefab Library now looks more like an actual Prefab Library.

### 7. Better Home Project UI + Folders

In `0.1.0`, maps and the prefab libraries are in one single UI (each are listed in cards, which is... crude, and doesn't look good). What if I want to have folders to organize my maps? Same goes for prefab libraries.

Now, you get a better card listing, with that comes search, folder create, and folder dragging! yay!

### 8. Disallow Illegal Naming that will affect file indexing at places

There's some places that now does not allow names that causes file-indexing to fail. In the sense of: "I'm very unsure whether I should make my prefab name have something like 'MountainTile/Full' or 'MountainTile Full'"

This is a reasonable compromise for storing files in folders.

### 9. Disallow illegal actions

i.e. creating duplicate named prefabs, duplicate named maps, duplicate named specs etc, renaming smth to an already-existing same-name thing

### 10. Actual Keybinded App Actions

Nuxt's defineShortcuts() isn't the solution to everything. For a fun fact, they don't work when you're focused on input bars. So: Tauri has the Menu API, which is like those "File" "Edit" "View" top-of-the-window dropdowns you'd see on MacOS when you open some app. Dropdowns now contains Save, Open, actions and etc, and luckily, Tauri Provides apis that allows me to do them. And even more fortunately, I've done this before! (Check out https://github.com/CTRL-Neo-Studios/vertex/blob/t32/feature/workflows/app/composables/app/useAppWindowMenu.ts)

## [0.1.5] Updater!

We now have a built in updater.
