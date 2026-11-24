<script lang="ts">
  import type { Map } from 'maplibre-gl';
  import MapView from '../../lib/MapView.svelte';
  import { facilities } from '../../lib/facilities';
  import { capacityRange, colorByType, FACILITY_TYPES, radiusByCapacity } from './style';

  function onload(map: Map) {
    map.addSource('facilities', { type: 'geojson', data: facilities });
    map.addLayer({
      id: 'facilities',
      type: 'circle',
      source: 'facilities',
      paint: {
        'circle-color': colorByType(),
        'circle-radius': radiusByCapacity(capacityRange(facilities)),
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
        'circle-opacity': 0.9,
      },
    });
  }
</script>

<MapView {onload} />

<aside class="panel" aria-label="Legend">
  <h2>Facilities</h2>
  <ul>
    {#each FACILITY_TYPES as type (type.id)}
      <li><span class="swatch" style:background={type.color}></span>{type.label}</li>
    {/each}
  </ul>
  <p class="note">Circle size is proportional to capacity.</p>
</aside>

<style>
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
  }

  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid #fff;
    box-shadow: 0 0 0 1px var(--color-border);
  }

  .note {
    margin: var(--space-3) 0 0;
    font-size: 0.85rem;
    color: var(--color-muted);
  }
</style>
