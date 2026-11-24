# svelte-maplibre

Eight katas on building web map viewers with Svelte 5 and MapLibre GL JS, solved and explained, on top of public ICGC (Institut Cartogràfic i Geològic de Catalunya) services. They are meant to prepare a live coding test for web map viewer development.

## Run

Requires Node 22.12 or later.

```bash
cd svelte-maplibre
npm install
npm run dev      # http://localhost:5801
npm test         # tests for the pure logic
npm run check    # type checking (TypeScript and Svelte)
```

The left menu opens each exercise. The statement, the explained solution and the common mistakes are in the `README.md` of each folder.

## How to use these katas

1. Read the exercise statement (only the "Statement" section).
2. Try to solve it **yourself, in an empty project, without an assistant**. Official documentation only.
3. If you get stuck, read "How to approach it, step by step" and carry on.
4. When done, compare with the solution and read "Solution explained" and "Common mistakes".
5. Repeat the exercise another day without looking.

| Exercise                                                             | What it practises                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| [Base map and controls](src/exercises/base-map/README.md)            | Lifecycle, `$effect`, cleanup                             |
| [Data-driven style](src/exercises/data-driven-style/README.md)       | Sources, layers, `match` and `interpolate` expressions    |
| [Popup and side panel](src/exercises/popup-and-panel/README.md)      | Layer events, `feature-state`, `$state`                   |
| [ICGC WMS layer](src/exercises/wms-layer/README.md)                  | WMS, `{bbox-epsg-3857}`, layer order                      |
| [Geocoder search](src/exercises/geocoder-search/README.md)           | `fetch`, debounce, `AbortController`, accessible combobox |
| [Visible area and synced list](src/exercises/visible-area/README.md) | `moveend`, bbox, syncing map and list                     |
| [Clustering](src/exercises/clustering/README.md)                     | `cluster`, `step`, `getClusterExpansionZoom`              |
| [Integrated viewer](src/exercises/integrated-viewer/README.md)       | Reprojection, filters, state in the URL, components       |

## Method for the coding test

1. **Read everything before writing.** Copy the requirements as a list and tick them off.
2. **First, something that works end to end**, even if it is ugly. A complete, simple solution scores higher than a perfect half.
3. **Move logic out of components** into pure functions in `.ts` files. One test for each.
4. **If something gets stuck, note it and move on.** At the end, explain how you would have solved it.
5. **Think out loud** if someone is watching: what you decide and why.
6. **Finish by testing the whole flow** and writing a short README.

## Svelte 5 cheat sheet

| I need…                                             | Use                                                           |
| --------------------------------------------------- | ------------------------------------------------------------- |
| A value the template renders and that changes       | `let x = $state(0)`                                           |
| A large object replaced as a whole (map, data)      | `let m = $state.raw(null)`                                    |
| A value computed from others                        | `const total = $derived(items.length)`                        |
| Syncing with something external (map, DOM, timer)   | `$effect(() => { ...; return () => cleanup() })`              |
| Reading something in an effect without rerunning it | `untrack(() => value)`                                        |
| Receiving props                                     | `let { a, b = 1 } = $props()`                                 |
| A prop the child can change                         | `let { v = $bindable() } = $props()` + `bind:v` in the parent |
| An event from a child component                     | Function prop: `onselect={(x) => ...}`                        |
| A reference to a DOM element                        | `bind:this={el}`                                              |
| Listening to `window` events                        | `<svelte:window onkeydown={...} />`                           |
| A list with stable identity                         | `{#each items as item (item.id)}`                             |

Rule of thumb: what happens because the user does something goes in the event handler; `$effect` is only for syncing with the outside world.

## MapLibre cheat sheet

| I need…                   | Use                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------- |
| To import it              | `import * as maplibregl from 'maplibre-gl'` (MapLibre 6 has no default export)          |
| To add data or layers     | Always after `map.on('load', ...)`                                                      |
| Data                      | `map.addSource(id, { type: 'geojson', data })`                                          |
| How it is drawn           | `map.addLayer({ id, type: 'circle', source, paint, layout, filter })`                   |
| To change the data        | `map.getSource<GeoJSONSource>(id).setData(fc)`                                          |
| To change a layer's style | `setPaintProperty`, `setLayoutProperty`                                                 |
| Color by category         | `['match', ['get', 'type'], 'a', '#f00', 'b', '#0f0', '#999']`                          |
| Continuous size           | `['interpolate', ['linear'], ['get', 'value'], min, r1, max, r2]`                       |
| Size in steps             | `['step', ['get', 'value'], r0, threshold1, r1]`                                        |
| To highlight a feature    | `setFeatureState({ source, id }, { selected: true })` + `['feature-state', 'selected']` |
| A click on a layer        | `map.on('click', 'layer-id', (e) => e.features[0])`                                     |
| What is under a pixel     | `map.queryRenderedFeatures(e.point, { layers })`                                        |
| The end of a movement     | `map.on('moveend', ...)`                                                                |
| To go somewhere           | `flyTo` (animated, with an arc) or `easeTo` (linear)                                    |
| To destroy it             | `map.remove()`                                                                          |
| Coordinates               | Always `[longitude, latitude]`                                                          |

## Data

`src/data/facilities.json` (EPSG:4326) and `public/data/facilities-25831.json` (EPSG:25831) hold the same 26 **fictional** facilities: the names are made up and the positions are approximate, in real municipalities. The external services (ContextMaps style, WMS and geocoder) are public ICGC services.
