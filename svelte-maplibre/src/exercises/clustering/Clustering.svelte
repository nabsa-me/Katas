<script lang="ts">
  import type { Point } from 'geojson';
  import * as maplibregl from 'maplibre-gl';
  import MapView from '../../lib/MapView.svelte';
  import { facilities, type FacilityProps } from '../../lib/facilities';
  import { ICGC_FONT_BOLD } from '../../lib/icgc';
  import { colorByType } from '../data-driven-style/style';
  import { CLUSTER_STEPS, stepByCount } from './cluster';

  const SOURCE = 'facilities';

  let popup: maplibregl.Popup | null = null;

  function onload(map: maplibregl.Map) {
    map.addSource(SOURCE, {
      type: 'geojson',
      data: facilities,
      cluster: true,
      clusterRadius: 50, // pixels: points closer than this are grouped
      clusterMaxZoom: 13, // from zoom 14 every point is shown on its own
    });

    // Layer 1: cluster circles (only features with point_count).
    map.addLayer({
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

    // Layer 2: the count of each cluster. The font must exist in the style's glyphs.
    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: SOURCE,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': [ICGC_FONT_BOLD],
        'text-size': 13,
      },
      paint: { 'text-color': '#ffffff' },
    });

    // Layer 3: single points (no point_count).
    map.addLayer({
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

    map.on('click', 'clusters', async (e) => {
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (!feature || typeof clusterId !== 'number') return;
      const source = map.getSource<maplibregl.GeoJSONSource>(SOURCE);
      if (!source) return;
      // Minimum zoom at which this cluster splits. In current MapLibre it returns a promise.
      const zoom = await source.getClusterExpansionZoom(clusterId);
      map.easeTo({ center: (feature.geometry as Point).coordinates as [number, number], zoom });
    });

    map.on('click', 'unclustered', (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const props = feature.properties as FacilityProps;
      popup?.remove();
      popup = new maplibregl.Popup({ offset: 10 })
        .setLngLat((feature.geometry as Point).coordinates as [number, number])
        .setText(`${props.name} (${props.municipality})`)
        .addTo(map);
    });

    for (const layer of ['clusters', 'unclustered']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
  }
</script>

<MapView {onload} />

<aside class="panel">
  <h2>Clustering</h2>
  <p>Green circles group nearby facilities. Click one to zoom in until it splits.</p>
</aside>

<style>
  p {
    margin: 0;
  }
</style>
