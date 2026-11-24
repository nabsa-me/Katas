# Clustering

## Statement

Show the facilities clustered: nearby points merge into a circle with the number of items, whose size and color depend on how many it groups. Clicking a cluster zooms in until it splits. Single points open a popup.

## What gets assessed

- Knowing how to enable clustering on the source and which properties it generates.
- Separating clusters and single points with layer filters.
- Using `getClusterExpansionZoom` with the current API (promise).
- Knowing when clustering is the answer and when it is not.

## How to approach it, step by step

1. GeoJSON source with `cluster: true`, `clusterRadius` and `clusterMaxZoom`.
2. Three layers on the same source:
   - cluster circles, with `filter: ['has', 'point_count']`;
   - cluster count (a `symbol` layer);
   - single points, with `filter: ['!', ['has', 'point_count']]`.
3. Click on a cluster: read `cluster_id`, ask the source for the expansion zoom and call `easeTo`.
4. Click on a single point: popup with `setText`.

## Solution explained

**What `cluster: true` does.** MapLibre groups the points in a worker, off the main thread, for each zoom level (it is the Supercluster algorithm, which current versions bundle inside `@maplibre/geojson-vt`). Each cluster is a new feature with the properties `cluster: true`, `cluster_id`, `point_count` and `point_count_abbreviated` (for example, "1.2k"). Single points keep their original properties.

**`step` expression**, generated in [`cluster.ts`](./cluster.ts):

```ts
['step', ['get', 'point_count'], 16, 5, 22, 10, 28];
```

Fewer than 5 points: radius 16; 5 to 9: 22; 10 or more: 28. Unlike `interpolate`, `step` jumps at each threshold, which is what you want for size categories. The thresholds are defined once (`CLUSTER_STEPS`) and both color and radius come from them.

**Text needs a font that exists on the style's glyph server.** The ICGC style serves `FiraSans-Regular`, `FiraSans-Bold` and `FiraSans-Italic`. If you ask for a font that is not there (for example, "Open Sans Bold"), the count does not appear and the console shows 404 errors for glyphs.

**`getClusterExpansionZoom`** returns the zoom at which the cluster splits. In MapLibre 4 and later it returns a **promise**; older code uses a callback. In a coding test, using the callback version with a current library is a visible mistake.

**When not to cluster.** GeoJSON clustering runs in the browser and works up to tens of thousands of points. For hundreds of thousands or millions, the right answer is vector tiles generated on the server, or a `heatmap` layer if density is what matters.

## Common mistakes

| Symptom                                         | Cause                                                          |
| ----------------------------------------------- | -------------------------------------------------------------- |
| Clusters show no count                          | The text font does not exist in the style's glyphs.            |
| Single points are also drawn under the clusters | The point layer lacks the `!has point_count` filter.           |
| `getClusterExpansionZoom` does nothing          | Used with a callback in a version that returns a promise.      |
| Clusters never fully split                      | `clusterMaxZoom` greater than or equal to the source max zoom. |

## Practice

Use `clusterProperties` so each cluster adds up the capacity of its facilities (`['+', ['get', 'capacity']]`) and show that total in a popup when hovering the cluster.
