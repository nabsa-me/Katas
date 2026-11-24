# Visible area and synced list

## Statement

Next to the map, a list of the facilities visible on screen, sorted by name, with a counter. The list updates when the map moves. Hovering an item in the list highlights its point on the map, and hovering a point highlights its item in the list. Clicking an item centers the map on that facility.

## What gets assessed

- Which event to use to know the map has moved.
- How to decide what is "in view" and why.
- Syncing two views of the same data without duplicating logic.
- Performance: not recomputing on every frame.

## How to approach it, step by step

1. Listen to `moveend` (not `move`, which fires dozens of times per second while dragging).
2. Read the bounds with `map.getBounds()` and turn them into `[west, south, east, north]`.
3. Filter the data with a pure function and test it.
4. Store the result in `$state` and render it with `{#each}`.
5. Write one `setHover(id)` function that updates both the `feature-state` and the list state. Call it from the map and from the list.

## Solution explained

**Two ways to know what is in view:**

|                                               | Filter your data by bbox (this solution) | `map.queryRenderedFeatures()`             |
| --------------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| What it returns                               | Your original, complete features         | What MapLibre has drawn                   |
| Duplicated features                           | No                                       | Possible if a feature spans several tiles |
| Features hidden by collision or layer filters | Included                                 | Not included                              |
| When to use it                                | Your own data in memory                  | Data that only exists as vector tiles     |

With your own GeoJSON in memory, filtering by bbox is simpler, testable and predictable.

**Pure logic** in [`visible.ts`](./visible.ts): `isInBbox` and `featuresInBbox`. Sorting uses `localeCompare(..., 'ca')` because the names are Catalan proper nouns, so accented letters sort correctly ("Àrea" comes before "El"). A test also checks that swapped coordinates (lat, lon) do not slip through.

**One gate for hover.** `setHover` clears the previous feature's state, sets the new one and updates `hoveredId`, which the list uses to highlight its item (`class:active`). Since both the map and the list use it, they cannot get out of sync.

**Accessibility.** List items are `<button>`s: they can be reached with Tab and activated with Enter. `onfocus` and `onblur` make the highlight work with the keyboard too.

**Known limitation.** The bbox does not work if the view crosses the antimeridian (west > east) or if the map is pitched, because then the visible area is not a rectangle. For Catalonia in 2D it does not happen, but it is worth being able to say so.

## Common mistakes

| Symptom                         | Cause                                            |
| ------------------------------- | ------------------------------------------------ |
| The UI lags while dragging      | Recomputed on `move` instead of `moveend`.       |
| The list is empty at first      | Not computed on load, only after the first move. |
| Several points stay highlighted | Hover is handled in two different places.        |
| Odd order with accented names   | `sort()` without `localeCompare`.                |

## Practice

Add a "visible area only" toggle to see the full list, and a text filter that combines with the visible area.
