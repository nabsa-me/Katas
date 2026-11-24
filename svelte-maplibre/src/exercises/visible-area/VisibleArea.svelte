<script lang="ts">
  import type { Map } from 'maplibre-gl';
  import MapView from '../../lib/MapView.svelte';
  import { facilities, type Facility } from '../../lib/facilities';
  import { colorByType } from '../data-driven-style/style';
  import { featuresInBbox, type Bbox } from './visible';

  const SOURCE = 'facilities';

  let map: Map | null = null;
  let visible = $state<Facility[]>([]);
  let hoveredId = $state<string | number | null>(null);

  function updateVisible() {
    if (!map) return;
    const b = map.getBounds();
    const bbox: Bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    visible = featuresInBbox(facilities.features, bbox);
  }

  /** Single entry point for hover, whether it comes from the map or from the list. */
  function setHover(id: string | number | null) {
    if (!map || id === hoveredId) return;
    if (hoveredId !== null) map.setFeatureState({ source: SOURCE, id: hoveredId }, { hover: false });
    if (id !== null) map.setFeatureState({ source: SOURCE, id }, { hover: true });
    hoveredId = id;
  }

  function onload(m: Map) {
    map = m;
    map.addSource(SOURCE, { type: 'geojson', data: facilities });
    map.addLayer({
      id: 'facilities',
      type: 'circle',
      source: SOURCE,
      paint: {
        'circle-color': colorByType(),
        'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 11, 7],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 1.5],
      },
    });

    map.on('moveend', updateVisible);
    map.on('mousemove', 'facilities', (e) => setHover(e.features?.[0]?.id ?? null));
    map.on('mouseleave', 'facilities', () => setHover(null));
    updateVisible();
  }

  function flyTo(facility: Facility) {
    map?.flyTo({ center: facility.geometry.coordinates as [number, number], zoom: 14 });
  }
</script>

<MapView {onload} />

<aside class="panel" aria-label="Visible facilities">
  <h2>{visible.length} facilities in view</h2>
  {#if visible.length === 0}
    <p>Move the map or zoom out to see some.</p>
  {:else}
    <ul>
      {#each visible as facility (facility.id)}
        <li>
          <button
            type="button"
            class:active={facility.id === hoveredId}
            onmouseenter={() => setHover(facility.id ?? null)}
            onmouseleave={() => setHover(null)}
            onfocus={() => setHover(facility.id ?? null)}
            onblur={() => setHover(null)}
            onclick={() => flyTo(facility)}
          >
            <strong>{facility.properties.name}</strong>
            <span>{facility.properties.municipality}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button {
    display: grid;
    width: 100%;
    padding: var(--space-2);
    border: none;
    border-radius: var(--radius);
    background: none;
    text-align: left;
  }

  button span {
    font-size: 0.85rem;
    color: var(--color-muted);
  }

  button:hover,
  button.active {
    background: var(--color-surface);
  }

  p {
    margin: 0;
  }
</style>
