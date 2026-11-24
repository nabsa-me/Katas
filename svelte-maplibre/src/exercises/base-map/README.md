# Base map and controls

## Statement

Create a `MapView.svelte` component that shows a MapLibre map with the ICGC ContextMaps style, centered on Catalonia, with navigation and scale controls. The map must fill the available space and be released properly when the component goes away.

## What gets assessed

- That the map shows up (sounds obvious; it is the most common failure).
- That you know at which point of the Svelte lifecycle the map is created.
- That you destroy it on unmount (`map.remove()`).
- Correct coordinate order: `[longitude, latitude]`.

## How to approach it, step by step

1. Create the project: `npm create vite@latest my-map -- --template svelte-ts`, go into the folder, `npm install` and `npm install maplibre-gl`.
2. Add a `<div>` and keep a reference with `bind:this`. MapLibre needs a real DOM element.
3. Create the map inside `$effect`, which runs once the component is in the page.
4. Return a function from the `$effect` that calls `map.remove()`.
5. Import the MapLibre CSS and give the container a height.
6. Add the controls with `map.addControl(...)`.

## Solution explained

The code is in [`src/lib/MapView.svelte`](../../lib/MapView.svelte), because the other exercises reuse it. This exercise only mounts it.

```ts
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
```

MapLibre 6 **has no default export**. `import maplibregl from 'maplibre-gl'` fails. Use a namespace import (`* as maplibregl`) or named imports (`import { Map } from 'maplibre-gl'`). The CSS is required: without it, controls and popups are misplaced.

```ts
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
maplibregl.setWorkerUrl(workerUrl);
```

MapLibre processes tiles in a Web Worker that it loads from a file next to its own. Vite bundles and moves that file, so the worker URL is set explicitly. It goes in `<script module>` because it only needs to run once.

```ts
let container: HTMLDivElement;
```

```svelte
<div class="map" bind:this={container}></div>
```

`bind:this` stores the real element in `container` when the component mounts.

```ts
$effect(() => {
  const map = untrack(() => new maplibregl.Map({ container, style: ICGC_STYLE, center, zoom }));
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  map.on('load', () => untrack(() => onload?.(map)));
  return () => map.remove();
});
```

- **`$effect`** runs after the component mounts, when `container` already exists. In Svelte 4 this was `onMount`; in Svelte 5 `onMount` still works, but `$effect` with its cleanup function is the current pattern.
- **`untrack`**: `$effect` reruns whenever a reactive value it reads changes. `center`, `zoom` and `onload` are props (reactive). Without `untrack`, if the parent changed the center, the effect would destroy and recreate the whole map. Here they are only initial values.
- **`map.on('load')`**: sources and layers cannot be added until the style has loaded. That is why the component notifies the parent through `onload` at that moment.
- **`return () => map.remove()`**: releases the WebGL context, the workers and the listeners. Without it, after switching views a few times the browser warns about "too many active WebGL contexts".

```css
.map {
  position: absolute;
  inset: 0;
}
```

The container fills its parent (which has `position: relative`). An empty `<div>` has height 0: the map would exist but you would not see it.

The ICGC attribution appears on its own, because it is declared in the ContextMaps style source.

## Common mistakes

| Symptom                                            | Cause                                                 |
| -------------------------------------------------- | ----------------------------------------------------- |
| Blank screen and no errors                         | The container has no height.                          |
| `does not provide an export named 'default'`       | `import maplibregl from 'maplibre-gl'` in MapLibre 6. |
| The map shows the ocean or Africa                  | `center` in `[lat, lon]` order.                       |
| Controls without icons or misplaced                | `maplibre-gl.css` not imported.                       |
| `addSource` fails with "Style is not done loading" | Layers added before the `load` event.                 |

## Practice

Rebuild the component from scratch without looking. Then add a `style` prop to switch between `icgc.json` and another ContextMaps style, changing it with `map.setStyle()` without recreating the map.
