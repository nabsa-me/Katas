# Popup and side panel

## Statement

On top of the facilities from [Data-driven style](../data-driven-style/README.md):

- Clicking a point opens a popup with its name and a side panel with its details.
- The selected point is highlighted.
- Escape, the "Close" button or a click on an empty area of the map clear the selection.

## What gets assessed

- MapLibre layer events: `map.on('click', 'layer-id', ...)`.
- Highlighting with **`feature-state`** instead of changing the data or adding another layer.
- UI state in Svelte (`$state`) kept in sync with the map.
- Security: not putting data into the popup as HTML.

## How to approach it, step by step

1. Reuse the layer from [Data-driven style](../data-driven-style/README.md).
2. Listen to clicks on the layer and read `e.features[0]`: it has `id`, `properties` and `geometry`.
3. Keep the selection in `$state` so the panel updates on its own.
4. To highlight, use `map.setFeatureState({ source, id }, { selected: true })` and, in the style, a `case` expression that reads `['feature-state', 'selected']`.
5. When the selection changes, clear the state of the previous feature. This logic is pure: extract it into a function and test it.
6. Add the three ways to clear: Escape, button and click on an empty area.

## Solution explained

**`feature-state`** is state that MapLibre keeps per feature, outside the data. Changing it is cheap: the GeoJSON is not reprocessed and tiles are not rebuilt. Requirement: every feature needs an `id`. Here it comes in the GeoJSON (`"id": 1`); if it were in the properties, you would use the source's `promoteId` option.

```ts
'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 11, 7]
```

`['boolean', ..., false]` turns the value into a boolean with `false` as default, because at first no feature has any state.

**The selection logic**, in [`selection.ts`](./selection.ts), decides which id to clear and which one to set. It is pure and tested: selecting the same point again does nothing; selecting another point clears the previous one.

**Two kinds of variables in the component:**

- `selected` is `$state` because the template renders it (the panel).
- `map`, `popup` and `selectedId` are plain variables: the template does not use them and they need no reactivity. Making an object like the map reactive adds nothing and has a cost.

**Click on an empty area.** The layer click and the general click both fire. The general one checks whether there was anything under the cursor with `queryRenderedFeatures(e.point, { layers: [...] })`; if there was nothing, it clears.

**Safe popup.** `setText(props.name)` instead of `setHTML(...)`: if a name contained `<img onerror=...>`, `setHTML` would run it. Mentioning it in an interview earns points.

**Accessibility.** The panel has `aria-live="polite"`, so a screen reader announces the change. The cursor turns into a pointer over a point.

**Global keyboard.** `<svelte:window {onkeydown} />` adds the listener to `window`, and Svelte removes it on unmount.

## Common mistakes

| Symptom                                             | Cause                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| Highlighting does nothing                           | Features have no `id`, or the source passed to `setFeatureState` is wrong. |
| Several points stay highlighted                     | The previous feature's state is not cleared.                               |
| The panel does not update                           | The selection is not in `$state`.                                          |
| Clicking a point also triggers the empty-area clear | It does not check whether there were features under the cursor.            |

## Practice

Add a hover highlight with a second `feature-state`, independent of the selection.
