<script lang="ts">
  import type { Point } from 'geojson';
  import * as maplibregl from 'maplibre-gl';
  import MapView from '../../lib/MapView.svelte';
  import { facilities, type FacilityProps } from '../../lib/facilities';
  import { colorByType, FACILITY_TYPES } from '../data-driven-style/style';
  import { selectionChange, type FeatureId } from './selection';

  const SOURCE = 'facilities';

  let map: maplibregl.Map | null = null;
  let popup: maplibregl.Popup | null = null;
  let selectedId: FeatureId | null = null;
  let selected = $state<FacilityProps | null>(null);

  function select(id: FeatureId | null, props: FacilityProps | null, lngLat?: maplibregl.LngLatLike) {
    if (!map) return;
    const change = selectionChange(selectedId, id);
    if (change.clear !== null) map.setFeatureState({ source: SOURCE, id: change.clear }, { selected: false });
    if (change.set !== null) map.setFeatureState({ source: SOURCE, id: change.set }, { selected: true });
    selectedId = id;
    selected = props;

    popup?.remove();
    popup = null;
    if (props && lngLat) {
      // setText, not setHTML: data is never interpreted as HTML (prevents code injection).
      popup = new maplibregl.Popup({ closeButton: false, offset: 12 }).setLngLat(lngLat).setText(props.name).addTo(map);
    }
  }

  function onload(m: maplibregl.Map) {
    map = m;
    map.addSource(SOURCE, { type: 'geojson', data: facilities });
    map.addLayer({
      id: 'facilities',
      type: 'circle',
      source: SOURCE,
      paint: {
        'circle-color': colorByType(),
        'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 11, 7],
        'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#1d2a33', '#ffffff'],
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 1.5],
      },
    });

    map.on('click', 'facilities', (e) => {
      const feature = e.features?.[0];
      if (!feature || feature.id === undefined) return;
      const point = feature.geometry as Point;
      select(feature.id, feature.properties as FacilityProps, point.coordinates as [number, number]);
    });

    // Click outside any point: clear the selection.
    map.on('click', (e) => {
      const hits = map!.queryRenderedFeatures(e.point, { layers: ['facilities'] });
      if (hits.length === 0) select(null, null);
    });

    map.on('mouseenter', 'facilities', () => (map!.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'facilities', () => (map!.getCanvas().style.cursor = ''));
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') select(null, null);
  }

  const typeLabel = (id: string) => FACILITY_TYPES.find((t) => t.id === id)?.label ?? id;
</script>

<svelte:window {onkeydown} />

<MapView {onload} />

<aside class="panel" aria-live="polite" aria-label="Facility details">
  {#if selected}
    <h2>{selected.name}</h2>
    <dl>
      <dt>Type</dt>
      <dd>{typeLabel(selected.type)}</dd>
      <dt>Municipality</dt>
      <dd>{selected.municipality}</dd>
      <dt>Capacity</dt>
      <dd>{selected.capacity} people</dd>
    </dl>
    <button type="button" onclick={() => select(null, null)}>Close</button>
  {:else}
    <p>Click a facility to see its details.</p>
  {/if}
</aside>

<style>
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0 0 var(--space-3);
  }

  dt {
    color: var(--color-muted);
  }

  dd {
    margin: 0;
  }

  p {
    margin: 0;
  }
</style>
