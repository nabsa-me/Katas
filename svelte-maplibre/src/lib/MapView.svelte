<!--
  Base map component (built in the base map exercise and reused by the others).
  Creates the map on mount, calls `onload` once the style is loaded
  and destroys the map on unmount.
-->
<script lang="ts" module>
  import * as maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  // MapLibre looks for its worker next to its own file. Vite bundles that file and moves it,
  // so the worker URL is set explicitly.
  // It lives in <script module> because it only has to run once, not per component instance.
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

  maplibregl.setWorkerUrl(workerUrl);
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { CATALONIA_CENTER, CATALONIA_ZOOM, ICGC_STYLE } from './icgc';

  interface Props {
    center?: [number, number];
    zoom?: number;
    onload?: (map: maplibregl.Map) => void;
  }

  let { center = CATALONIA_CENTER, zoom = CATALONIA_ZOOM, onload }: Props = $props();

  let container: HTMLDivElement;

  $effect(() => {
    // untrack: center, zoom and onload are only used to create the map.
    // Without untrack, if the parent changed those props the effect would destroy and recreate the map.
    const map = untrack(
      () =>
        new maplibregl.Map({
          container,
          style: ICGC_STYLE,
          center,
          zoom,
        }),
    );

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    map.on('load', () => untrack(() => onload?.(map)));

    // Cleanup: releases the WebGL context, the workers and the listeners.
    return () => map.remove();
  });
</script>

<div class="map" bind:this={container}></div>

<style>
  .map {
    position: absolute;
    inset: 0;
  }
</style>
