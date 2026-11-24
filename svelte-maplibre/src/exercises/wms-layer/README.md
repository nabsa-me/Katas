# ICGC WMS layer

## Statement

Overlay a layer from the ICGC WMS on the base map (the geological map by default). The user can show or hide it, pick another layer from the same service and change its opacity.

## What gets assessed

- Knowing what a WMS is and how to consume it from a tile-based library.
- Requesting it in the map's reference system (EPSG:3857).
- Changing layer properties without recreating the map.
- Layer order: the layer must not cover the labels.

## How to approach it, step by step

1. Look at the service's GetCapabilities: it lists the layers (`LAYERS`) and the reference systems it supports. The ICGC base map WMS supports EPSG:3857.
2. Create a `raster` source with a GetMap URL that contains `{bbox-epsg-3857}`. MapLibre requests one image per tile and replaces that placeholder with each tile's bounds.
3. Add a `raster` layer below the first label layer.
4. Wire the controls with `setLayoutProperty` (visibility), `setPaintProperty` (opacity) and `setTiles` (WMS layer switch).

## Solution explained

**The URL** is built in [`wms.ts`](./wms.ts):

```
https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap
  &LAYERS=geologic&STYLES=&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true
  &BBOX={bbox-epsg-3857}
```

- `CRS` is the parameter name in WMS 1.3.0; in 1.1.1 it was `SRS`.
- In WMS 1.3.0, the `BBOX` axis order is the one defined by the reference system. For EPSG:3857 it is x, y (east, north), so no surprises. For EPSG:4326 it would be **latitude, longitude**: the best-known WMS pitfall.
- `TRANSPARENT=true` with PNG lets the base map show through.
- The placeholder is appended outside `URLSearchParams`, which would encode the braces (`%7B`) and MapLibre would no longer recognise it. A test checks this.

**Layer order.** The second argument of `addLayer` is the id of the layer to insert before. The first `symbol` (label) layer of the style is found, so the WMS layer sits below the names.

**State and effects.** `visible`, `layer` and `opacity` are `$state` bound to the controls with `bind:`. Each `$effect` applies one of them to the map. The map is stored with `$state.raw`: it must be state so the effects rerun once the map exists, but Svelte should not turn it into a deep proxy (`.raw` stores it as is).

**Switching the WMS layer** with `setTiles` changes the source URL without removing the source or the layer.

**WMS vs WMTS.** With WMS the server renders each image on request: flexible (any scale, styles) but slower. WMTS serves pre-rendered tiles on a fixed grid: much faster and cacheable, but nothing can change on the fly. For a base layer, WMTS; for a thematic layer that is queried or filtered, WMS. The same ICGC service also publishes WMTS, with URLs like `.../mapa-base/wmts/topografic/MON3857NW/{z}/{x}/{y}.png`.

## Common mistakes

| Symptom                                    | Cause                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| Empty or shifted tiles                     | A `CRS` the service does not support, or swapped axes with EPSG:4326 in 1.3.0.    |
| Requests with `%7Bbbox-epsg-3857%7D`       | The placeholder was encoded.                                                      |
| The layer covers the street names          | Added on top of everything, without `beforeId`.                                   |
| Error when changing opacity before loading | Effect ran when the layer did not exist yet (that is why `map` starts as `null`). |

## Practice

Implement "what is here?" with GetFeatureInfo: on click, build the request with the view's `BBOX` and the pixel's `I`, `J` coordinates. First check in the GetCapabilities that the layer is queryable (`queryable="1"`): the ICGC base map layers are not, so you will need another thematic service.
