<script lang="ts">
  import * as maplibregl from 'maplibre-gl';
  import MapView from '../../lib/MapView.svelte';
  import { ICGC_GEOCODER } from '../../lib/icgc';
  import {
    autocompleteUrl,
    debounce,
    DEBOUNCE_MS,
    MIN_CHARS,
    nextActiveIndex,
    parseResults,
    type SearchResult,
  } from './search';

  let map: maplibregl.Map | null = null;
  let marker: maplibregl.Marker | null = null;
  let controller: AbortController | null = null;

  let query = $state('');
  let results = $state<SearchResult[]>([]);
  let active = $state(-1);
  let loading = $state(false);
  let error = $state<string | null>(null);

  const open = $derived(results.length > 0);

  const search = debounce(async (text: string) => {
    // Abort the previous request: results from an old search are never shown.
    controller?.abort();
    controller = new AbortController();
    loading = true;
    try {
      const response = await fetch(autocompleteUrl(ICGC_GEOCODER, text), { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      results = parseResults(await response.json());
      active = -1;
      error = null;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      results = [];
      error = 'The search failed. Please try again.';
    } finally {
      loading = false;
    }
  }, DEBOUNCE_MS);

  function oninput() {
    const text = query.trim();
    if (text.length < MIN_CHARS) {
      search.cancel();
      controller?.abort();
      results = [];
      return;
    }
    search.call(text);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = nextActiveIndex(active, e.key, results.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(results[active]!);
    } else if (e.key === 'Escape') {
      results = [];
    }
  }

  function choose(result: SearchResult) {
    query = result.label;
    results = [];
    if (!map) return;
    const lngLat: [number, number] = [result.lon, result.lat];
    map.flyTo({ center: lngLat, zoom: 14 });
    marker?.remove();
    marker = new maplibregl.Marker({ color: '#0b6e4f' }).setLngLat(lngLat).addTo(map);
  }

  // Cleanup when leaving the exercise: timer, pending request and marker.
  $effect(() => () => {
    search.cancel();
    controller?.abort();
    marker?.remove();
  });
</script>

<MapView onload={(m) => (map = m)} />

<div class="panel search">
  <label for="search">Search a place</label>
  <input
    id="search"
    type="search"
    autocomplete="off"
    placeholder="Municipality, address, place name…"
    role="combobox"
    aria-expanded={open}
    aria-controls="results"
    aria-autocomplete="list"
    aria-activedescendant={active >= 0 ? `result-${active}` : undefined}
    bind:value={query}
    {oninput}
    {onkeydown}
  />

  {#if loading}<p class="status">Searching…</p>{/if}
  {#if error}<p class="status error" role="alert">{error}</p>{/if}

  <!-- mousedown keeps the input from losing focus before the click on an option -->
  <ul id="results" role="listbox" hidden={!open} onmousedown={(e) => e.preventDefault()}>
    {#each results as result, i (`${i}-${result.label}`)}
      <!-- The keyboard is handled from the input (ARIA combobox pattern): focus never leaves it. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <li id="result-{i}" role="option" aria-selected={i === active} onclick={() => choose(result)}>
        <strong>{result.label}</strong>
        <span>{[result.type, result.municipality].filter(Boolean).join(' · ')}</span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .search {
    display: grid;
    gap: var(--space-2);
  }

  label {
    font-weight: 600;
  }

  input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }

  .status {
    margin: 0;
    font-size: 0.85rem;
    color: var(--color-muted);
  }

  .error {
    color: #b00020;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }

  li {
    display: grid;
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
  }

  li span {
    font-size: 0.85rem;
    color: var(--color-muted);
  }

  li:hover,
  li[aria-selected='true'] {
    background: var(--color-surface);
  }
</style>
