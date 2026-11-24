# Integrated viewer

## Statement

You are given a GeoJSON file of facilities **in EPSG:25831** (ETRS89 / UTM 31N), as a GIS would export it. Build a viewer that:

1. Loads the file, reprojects it to WGS84 and draws it with clustering.
2. Lets the user filter by type and search by name or municipality (ignoring accents and case).
3. Shows a list of results; clicking one flies the map to it and opens its popup.
4. Stores the view (zoom and center) and the filters in the URL: after a reload, everything is the same.
5. Keeps pure logic out of the components and tests it.

It is the format closest to a real coding test: several small pieces you already know, combined in a single viewer.

## What gets assessed

- That it works end to end before polishing.
- Knowing why you must reproject and doing it right (axis order, validation).
- Structure: small components with clear props and logic outside them.
- Product details: state in the URL, visible loading errors.

## How to approach it, step by step

1. Read, list the requirements, look at the file (which CRS does it declare? which properties?).
2. Load with `fetch`, reproject (with a test) and draw the points. **You now have something to show.**
3. Clustering and popup (copied from [Clustering](../clustering/README.md)).
4. Filters + list (pure logic, test first).
5. State in the URL (with a test).
6. Test the whole flow, reload, write a 3-line README.

## Solution explained

**Structure:**

```
integrated-viewer/
├── IntegratedViewer.svelte   orchestrates: map, data, state and URL
├── Filters.svelte            type checkboxes + search (props with $bindable)
├── ResultList.svelte         results (props + onselect callback)
├── reproject.ts              EPSG:25831 → EPSG:4326, with validation
├── filter.ts                 filter by type and text
└── url-state.ts              state ↔ URL parameters
```

**Reprojection** ([`reproject.ts`](./reproject.ts)):

- EPSG:25831 is defined in proj4 (`+proj=utm +zone=31 +ellps=GRS80 ...`); proj4 ships 4326 and 3857, but not 25831.
- The CRS declared in the file is checked. Modern GeoJSON (RFC 7946) dropped the `crs` member and requires WGS84, but many GIS tools still write it the old way (`urn:ogc:def:crs:EPSG::25831`).
- Every point is checked against the UTM extent of Catalonia. This catches the classic mistake: a file that claims to be in 25831 but holds degrees. There is a test for that case.
- The tests compare against values computed with PROJ (the reference library), with a 1 cm tolerance. Comparing proj4 with itself would prove nothing.

**Filter** ([`filter.ts`](./filter.ts)): `normalize` strips accents with `normalize('NFD')` and the Unicode class `\p{Diacritic}`, so "geltru" finds "Geltrú".

**State in the URL** ([`url-state.ts`](./url-state.ts)):

- `serializeState` rounds (5 decimals ≈ 1 m) so the URL stays readable.
- `parseState` trusts nothing: non-numeric or out-of-range values and unknown types fall back to the default, because anyone can write the URL.
- `history.replaceState` is used, not `pushState`: if every map move created a history entry, the back button would be useless.

**Svelte 5 in this exercise:**

- `$state.raw` for the map and the data: they are replaced whole, no deep reactivity needed.
- `$derived` for the filtered list: recomputed on its own when data, types or query change.
- One `$effect` syncs the filtered list with the map source (`setData`); another writes the URL when the filters change.
- `Filters` receives `bind:types` and `bind:query` (`$bindable` props); `bind:group` on checkboxes keeps an array.
- `ResultList` receives data and an `onselect` callback: in Svelte 5, component events are function props.

## Common mistakes

| Symptom                                           | Cause                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| Points appear in the Gulf of Guinea or not at all | UTM coordinates drawn as if they were degrees, or the other way round. |
| `proj4` does not know `EPSG:25831`                | Missing `proj4.defs(...)`.                                             |
| Searching "geltru" does not find "Geltrú"         | Comparison without normalising.                                        |
| The back button does not leave the exercise       | `pushState` on every move.                                             |
| The filter is lost on reload                      | The URL is written but not read on start.                              |

## Practice

Build the whole exercise from an empty project. On the first attempt, note where you get stuck; repeat until you can build it without looking at the solution.
