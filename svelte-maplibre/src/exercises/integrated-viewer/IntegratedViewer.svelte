<script lang="ts">
  import type { FeatureCollection, Point } from 'geojson';
  import * as maplibregl from 'maplibre-gl';
  import MapView from '../../lib/MapView.svelte';
  import type { Facility, FacilityProps } from '../../lib/facilities';
  import { ICGC_FONT_BOLD } from '../../lib/icgc';
  import { buildHash, parseHash } from '../../router';
  import { colorByType } from '../data-driven-style/style';
  import { CLUSTER_STEPS, stepByCount } from '../clustering/cluster';
  import Filters from './Filters.svelte';
  import ResultList from './ResultList.svelte';
  import { filterFacilities } from './filter';
  import { reprojectFacilities } from './reproject';
  import { parseState, serializeState } from './url-state';

  const SOURCE = 'facilities';
  const DATA_URL = '/data/facilities-25831.json';

  // Initial state read from the URL: reloading the page restores view and filters.
  const route = parseHash(window.location.hash);
  const initial = parseState(route.query);

  let map = $state.raw<maplibregl.Map | null>(null);
  let all = $state.raw<Facility[]>([]);
  let types = $state(initial.types);
  let query = $state(initial.query);
  let error = $state<string | null>(null);
  let popup: maplibregl.Popup | null = null;

  const filtered = $derived(filterFacilities(all, { types, query }));

  // Syncs the filtered data with the map source.
  $effect(() => {
    const data: FeatureCollection<Point, FacilityProps> = { type: 'FeatureCollection', features: filtered };
    map?.getSource<maplibregl.GeoJSONSource>(SOURCE)?.setData(data);
  });

  // Filters update the URL. The view is also written on moveend (see onload).
  $effect(() => {
    writeUrl(types, query);
  });

  function writeUrl(currentTypes = types, currentQuery = query) {
    const center = map?.getCenter();
    const params = serializeState({
      zoom: map?.getZoom() ?? initial.zoom,
      lon: center?.lng ?? initial.lon,
      lat: center?.lat ?? initial.lat,
      types: currentTypes,
      query: currentQuery,
    });
    // replaceState, not pushState: moving the map must not flood the browser history.
    // The id comes from the current route, so the hash keeps pointing at this exercise.
    history.replaceState(null, '', buildHash(route.id ?? '', params));
  }

  async function loadData() {
    try {
      const response = await fetch(DATA_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // The data arrives in ETRS89 UTM 31N; MapLibre works in lon/lat.
      all = reprojectFacilities(await response.json()).features;
    } catch (e) {
      error = `The data could not be loaded: ${(e as Error).message}`;
    }
  }

  function showPopup(facility: { geometry: Point; properties: FacilityProps }) {
    if (!map) return;
    popup?.remove();
    popup = new maplibregl.Popup({ offset: 10 })
      .setLngLat(facility.geometry.coordinates as [number, number])
      .setText(`${facility.properties.name} (${facility.properties.municipality})`)
      .addTo(map);
  }

  function onload(m: maplibregl.Map) {
    m.addSource(SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterRadius: 50,
      clusterMaxZoom: 13,
    });
    m.addLayer({
      id: 'clusters',
      type: 'circle',
      source: SOURCE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': stepByCount(CLUSTER_STEPS, (s) => s.color),
        'circle-radius': stepByCount(CLUSTER_STEPS, (s) => s.radius),
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });
    m.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: SOURCE,
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': [ICGC_FONT_BOLD], 'text-size': 13 },
      paint: { 'text-color': '#ffffff' },
    });
    m.addLayer({
      id: 'unclustered',
      type: 'circle',
      source: SOURCE,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': colorByType(),
        'circle-radius': 7,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });

    m.on('click', 'clusters', async (e) => {
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (!feature || typeof clusterId !== 'number') return;
      const zoom = await m.getSource<maplibregl.GeoJSONSource>(SOURCE)!.getClusterExpansionZoom(clusterId);
      m.easeTo({ center: (feature.geometry as Point).coordinates as [number, number], zoom });
    });

    m.on('click', 'unclustered', (e) => {
      const feature = e.features?.[0];
      if (feature) showPopup({ geometry: feature.geometry as Point, properties: feature.properties as FacilityProps });
    });

    for (const layer of ['clusters', 'unclustered']) {
      m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
    }

    m.on('moveend', () => writeUrl());

    map = m;
    loadData();
  }

  function select(facility: Facility) {
    map?.flyTo({ center: facility.geometry.coordinates as [number, number], zoom: 15 });
    showPopup(facility);
  }
</script>

<MapView center={[initial.lon, initial.lat]} zoom={initial.zoom} {onload} />

<aside class="panel" aria-label="Filters and results">
  <h2>Facilities</h2>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <Filters bind:types bind:query />
  <ResultList items={filtered} onselect={select} />
</aside>

<style>
  .error {
    color: #b00020;
  }
</style>
