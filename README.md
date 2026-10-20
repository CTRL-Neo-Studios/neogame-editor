# NeoMap Editor

This is meant to be used alongside [NeoGameLib](https://github.com/CTRL-Neo-Studios/NeoGameLib).

# Quick Start

You should have the NeoGameLib 0.4.0+ already installed in your MonoGame Project. If not, go install it, instructions in the library repo.

If you have installed: run the `dotnet build` command. This will generate the needed files for NeoMap Editor to recognize your MonoGame project.

Then, you can:
1. Open the Editor
2. Select your project folder and open it
3. Start editing.

If you have custom specs you'd like to add to your project schema for use in the editor:

1. Start a terminal in your project folder root
2. run `dotnet build`
3. Open NeoMap Editor
4. Select your project folder and open it

# Folders and naming (NeoGameLib 0.4.1+, NeoMap Editor 0.1.1+)

- Maps and prefab libraries can live in subfolders of `Data/NeoMaps/` and `Data/NeoPrefabs/`; the folder is part of the name (`forest/level1`). Moving or renaming one from the project page rewrites every reference to it (map `prefabs` lists, world actions) across the project.
- Map and library names are file paths: ASCII letters, digits, `_`, `-`, with spaces and dots allowed inside a segment but not at either end. Names that differ only by case are rejected.
- Prefab and collider-group names are plain keys: anything except `/`, control characters and leading/trailing spaces. Use a prefab folder instead of `/` (`MountainTile Full` in folder `MountainTile`). Prefab folders are editor-only grouping and never change a prefab's name.
