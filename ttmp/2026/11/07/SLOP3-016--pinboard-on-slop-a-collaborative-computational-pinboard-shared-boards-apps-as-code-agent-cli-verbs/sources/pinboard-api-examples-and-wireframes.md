Pinboarda pinboard of windows, an agent, and a grammar for little apps

[Sheets](#sheets)[Pipeline](#pipeline)[Examples](#examples)

# Pinboard: API examples and wireframes

Clips (notes, links, screenshots, documents, app windows) sit free on a canvas like a pinboard. A fluent, immutable builder grammar makes the clips and the ad-hoc apps that live among them; apps register into a quicklaunch and are kept in the browser. An agent with one tool, `eval`, turns loose clips into collections and builds apps over them, through the same mutations you make by hand.

**Sheets** 01 the board · 02 anatomy of a clip · 03 an app window · 04 the agent organising · 05 drop targets · 06 pinned and tiled · **Pipeline** builders → IR → render; mutations · **Examples** 00 the grammar · 01 a note · 02 paste · 03 first app · 04 params · 05 fragments · 06 IR and the DAG · 07 collections · 08 drag and drop · 09 diagnostics · 10 mutations · 11 the agent · 12 pin and tile · 13 everything at once

## Wireframes six sheets, drawn as drafting sheets: ink hairlines, paper fills, hatched shadows

**Sheet 01 · the board.** Header bar, free canvas with clips of four kinds and one app window, the quicklaunch, and the agent panel docked right. Everything is paper with 1 px ink; shadows are hatched, never grey.

**Sheet 02 · anatomy of a clip.** Every window on the board has the same bones: a 28 px title strip, a body the builder renders, a 24 px footer that fragments fill. The state row shows the only ways a clip looks different.

**Sheet 03 · an app window built with the grammar.** Toolbar, body and a params side column, all from one builder chain (example 13). Blue dashed lines are the runtime edges: which inputs re-run which nodes.

**Sheet 04 · the agent organising.** Left: a selection. Middle: the turn, step by step, with a waiting step in red. Right: the collection the steps made and the new app in the quicklaunch. Below: the mutation log both of you write to.

**Sheet 05 · drop targets.** One dragged link clip and the five places it can land. Targets show themselves with the red wash and nothing else; a refused drop says why in one line.

**Sheet 06 · pinned and tiled.** The same board with a saved layout: the free canvas is one tile, two app tiles are split on the right. Tiles split by 1 px gutters, tabs are 13 px with a dotted ink underline when active. The layout is a small tree kept in the browser.

## Pipeline what a builder becomes, and how runtime change flows back

**Pipeline.** Builders are for shape and compile to an IR once; the store and mutations are for change. The agent reads the board through `describe()` and changes it through the same mutations you do, so its work shows in the same log and undoes the same way.

## Examples simple to complex · every builder is immutable, every call returns a new one

00

### The grammar in one screen

atoms, modifiers, three ways out

01

### A note on the board

one line

02

### Paste anything

the board decides the clip kind from what arrived

03

### A first app, registered in the quicklaunch

state, two runtime lambdas, an icon

04

### Parameters

sliders and toggles become a side column; reading one makes a runtime edge

05

### Fragments

extend what a component can do, and what it draws, without subclassing

06

### The IR and the DAG

build is pure; inspect, diff, and reason about deps

07

### Collections

schema as a builder; live queries feed ui.each; clips can be promoted into rows

08

### Drag and drop

kinds on the dragged thing, accepts on the target; built-in targets listed

09

### Diagnostics through proxies

misuse gets a sentence, a suggestion and a source span

10

### Mutations at runtime

builders are for shape; mutations are for change

11

### The agent

one tool, the public API as its scope, the person chooses how much to approve

12

### Pin and tile

free windows by default; a layout is a small tree you can save

13

### Everything at once: a moodboard

fragments, params, state, a live query, drag and drop, agent hooks

Conventions carried from the design systems: white ground, one ink, Arial in two weights, 1 px rules for structure and one line weight only: state is carried by line style (solid, dotted, dashed) and by colour, never by thickness; square corners, no shadows in the UI (hatching on the sheets), one red for trouble and selection, text glyphs instead of icons, numbers tabular with units, copy in sentence case with no exclamation marks. Overlay hues (blue for data edges, violet for the agent) appear only in annotations, never in the interface.