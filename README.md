# NeoGame Editor

An editor for [NeoGameLib](https://github.com/CTRL-Neo-Studios/NeoGameLib) game data: maps and prefab libraries today, more NeoGameLib document types to come. (Formerly NeoMap Editor.)

# Quick Start

You should have the NeoGameLib 0.4.0+ already installed in your MonoGame Project. If not, go install it, instructions in the library repo.

If you have installed: run the `dotnet build` command. This will generate the needed files for NeoGame Editor to recognize your MonoGame project.

Then, you can:
1. Open the Editor
2. Select your project folder and open it
3. Start editing.

If you have custom specs you'd like to add to your project schema for use in the editor:

1. Start a terminal in your project folder root
2. run `dotnet build`
3. Open NeoGame Editor
4. Select your project folder and open it

# Folders and naming (NeoGameLib 0.4.1+, NeoGame Editor 0.1.1+)

- Maps and prefab libraries can live in subfolders of `Data/NeoMaps/` and `Data/NeoPrefabs/`; the folder is part of the name (`forest/level1`). Moving or renaming one from the project page rewrites every reference to it (map `prefabs` lists, world actions) across the project.
- Map and library names are file paths: ASCII letters, digits, `_`, `-`, with spaces and dots allowed inside a segment but not at either end. Names that differ only by case are rejected.
- Prefab and collider-group names are plain keys: anything except `/`, control characters and leading/trailing spaces. Use a prefab folder instead of `/` (`MountainTile Full` in folder `MountainTile`). Prefab folders are editor-only grouping and never change a prefab's name.

# Editing tips

- **Drag and drop:** in a prefab library, drag a prefab card onto a folder (tree row, folder card or breadcrumb) to move it there; drag a folder onto another to nest it. On the project page, dragging a map or library onto a folder opens the Rename / move dialog with that folder picked; nothing moves until you confirm.
- **Right-click** prefabs, collider groups, folders, layers, objects, editor tabs and the map canvas (Select/Move tools) for their actions. Paint tools keep right-click as erase.
- **Colliders** are drawn the way the game builds them (NeoGameLib 0.4.1): each collider group has its own color (legend at the bottom-left of the map), its Box Collider specs are the shape of one cell, and cells only merge along a side the box fully covers. Dashed teal = trigger, red = a prefab's or object's own collider.

# Adding a document type

Every project file type is one entry in `app/utils/documents.ts` (`DOC_KINDS`): its folder under `Data/`, extension, labels, icon and the body of a new file. That alone gives it a home-page panel with folders, create / rename / move / delete, file-watching and name validation. To make it editable:

1. a tab type for it in `app/composables/app/useAppTabs.ts` (`EditorTab`, plus `newTab`, `serialize`, `save`, `restore` for the new kind)
2. an editor component under `app/components/<kind>/`, registered in `EDITORS` in `app/pages/tabs/[tabId].vue`; it receives the open tab as `tab`
3. if other files reference it by name, rewrite rules in `app/utils/refs.ts`

Shared pieces any editor can use: `ProblemsPanel`, `StatusBar`, `inspector/*` (schema-driven spec/action fields), `usePanels`, `useContextTarget`, `RefreshSpecsButton`.

# Updates

The editor checks for updates on launch and from **Help › Check for updates…** (macOS: the app menu). Updates come from the studio's release service at `https://www.ctrl-neo.dev/apps` and are verified against the public key in `src-tauri/tauri.conf.json` before installing; unsaved tabs are saved or discarded first.

- **Channels:** `stable` (default) and `beta` are open to everyone. `insider` and `team` need an access token from the studio; paste it in the update dialog. Insiders also get stable and beta releases when those are newer.
- Installed versions never go down: switching to an older channel waits until it catches up.

# Releasing

Bump `version` in `src-tauri/tauri.conf.json` and push to `main`. `.github/workflows/release.yml` runs the studio's shared pipeline (`CTRL-Neo-Studios/prism`, `tauri-release.yml`): it builds Windows (NSIS), macOS (universal) and Linux (AppImage, best-effort), signs, uploads and publishes. Pushes that don't change the version build but don't publish.

- Versions are strict semver. A prerelease goes to the channel named by its tag: `0.2.0-beta.1` → `beta`, `0.2.0-insider.3` → `insider`; plain versions go to `stable`. Use a dot before the number (`alpha.10` sorts after `alpha.9`; `alpha10` sorts before `alpha9`).
- Repo secrets: `TAURI_SIGNING_PRIVATE_KEY` (the private key file's contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Losing the key means installed copies can never update again; keep it in the studio password manager.
