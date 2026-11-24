# Data-driven style

## Statement

Draw a GeoJSON of facilities on the map (properties `name`, `type`, `capacity`, `municipality`). The color depends on `type` and the circle size is proportional to `capacity`. Add a legend generated from the same configuration as the style.

## What gets assessed

- That you know the difference between a **source** (the data) and a **layer** (how it is drawn).
- That you use MapLibre **expressions** instead of styling each point by hand.
- That configuration is not duplicated: if the school color changes, it changes on the map and in the legend at once.

## How to approach it, step by step

1. Wait for the map `load` event (`MapView` gives it to you through `onload`).
2. `map.addSource('facilities', { type: 'geojson', data })`.
3. `map.addLayer({ type: 'circle', source: 'facilities', paint: {...} })`.
4. Write the list of types and colors in one place, and generate both the `match` expression and the legend from it.
5. Compute the minimum and maximum `capacity` and build an `interpolate` expression.

## Solution explained

**Data and style kept apart.** In [`style.ts`](./style.ts), `FACILITY_TYPES` is the single source of truth. The color expression is generated from it:

```ts
['match', ['get', 'type'], 'library', '#1b6ca8', 'school', '#e08a00', ..., '#7a7a7a']
```

`match` works like a `switch`: it reads each feature's `type` property and returns the color of the matching case. The last value is the default color; MapLibre requires it, and it also protects you from unexpected data.

**Proportional size:**

```ts
['interpolate', ['linear'], ['get', 'capacity'], 50, 5, 1200, 16];
```

A capacity of 50 gives a 5 px radius; 1200 gives 16 px; values in between are interpolated. If every value were the same, `interpolate` would be invalid (stops must increase), so the function returns a fixed radius in that case.

**Why pure functions.** `colorByType`, `capacityRange` and `radiusByCapacity` do not touch the map. That makes them testable ([`style.test.ts`](./style.test.ts)), and it is what reviewers expect in a coding test: logic outside the component.

**The legend** loops over `FACILITY_TYPES` with `{#each ... (type.id)}`. The key in parentheses lets Svelte identify each item when the list updates.

**Types.** `ExpressionSpecification` comes from `@maplibre/maplibre-gl-style-spec`, the package that defines the style specification. It is a dev dependency because `maplibre-gl` does not re-export that type.

## Common mistakes

| Symptom                                                                                                           | Cause                                                        |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `Expected an even number of arguments` or similar                                                                 | Missing default value at the end of `match`.                 |
| Every point has the default color                                                                                 | The property name does not match (`kind` instead of `type`). |
| `Input/output pairs for "interpolate" expressions must be arranged with input values in strictly ascending order` | Minimum and maximum equal or swapped.                        |
| Legend and map do not match                                                                                       | Colors written twice.                                        |

## Practice

Make the radius also grow with zoom: an outer `interpolate` on `['zoom']`, with the capacity expression at each stop.
