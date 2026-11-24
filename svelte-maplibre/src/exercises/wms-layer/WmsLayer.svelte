<script lang="ts">
  import type { Map, RasterTileSource } from 'maplibre-gl';
  import MapView from '../../lib/MapView.svelte';
  import { ICGC_BASE_MAP_WMS } from '../../lib/icgc';
  import { WMS_LAYERS, wmsTileUrl, type WmsLayerId } from './wms';

  const SOURCE = 'icgc-wms';
  const LAYER = 'icgc-wms';

  // $state.raw: the map is stored as is, without making it deeply reactive.
  // It has to be state so the effects run once the map exists.
  let map = $state.raw<Map | null>(null);
  let visible = $state(true);
  let layer = $state<WmsLayerId>('geologic');
  let opacity = $state(0.7);

  function onload(m: Map) {
    m.addSource(SOURCE, {
      type: 'raster',
      tiles: [wmsTileUrl(ICGC_BASE_MAP_WMS, layer)],
      tileSize: 256,
      attribution: 'Institut Cartogràfic i Geològic de Catalunya',
    });
    // Inserted below the first label layer, so place names stay readable.
    const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    m.addLayer({ id: LAYER, type: 'raster', source: SOURCE, paint: { 'raster-opacity': opacity } }, firstSymbol);
    map = m;
  }

  $effect(() => {
    map?.setLayoutProperty(LAYER, 'visibility', visible ? 'visible' : 'none');
  });

  $effect(() => {
    map?.setPaintProperty(LAYER, 'raster-opacity', opacity);
  });

  $effect(() => {
    // Switching WMS layer = switching the tile URL, without recreating the source.
    map?.getSource<RasterTileSource>(SOURCE)?.setTiles([wmsTileUrl(ICGC_BASE_MAP_WMS, layer)]);
  });
</script>

<MapView {onload} />

<aside class="panel" aria-label="WMS layer">
  <h2>ICGC WMS layer</h2>

  <label class="row">
    <input type="checkbox" bind:checked={visible} />
    Show layer
  </label>

  <label class="field">
    Layer
    <select bind:value={layer} disabled={!visible}>
      {#each WMS_LAYERS as option (option.id)}
        <option value={option.id}>{option.label}</option>
      {/each}
    </select>
  </label>

  <label class="field">
    Opacity: {Math.round(opacity * 100)} %
    <input type="range" min="0" max="1" step="0.05" bind:value={opacity} disabled={!visible} />
  </label>
</aside>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .field {
    display: grid;
    gap: var(--space-1);
    margin-bottom: var(--space-3);
  }
</style>
