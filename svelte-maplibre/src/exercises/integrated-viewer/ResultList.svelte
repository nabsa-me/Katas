<script lang="ts">
  import type { Facility } from '../../lib/facilities';

  interface Props {
    items: Facility[];
    onselect: (facility: Facility) => void;
  }

  let { items, onselect }: Props = $props();

  // Catalan collation: the names are Catalan proper nouns.
  const sorted = $derived([...items].sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'ca')));
</script>

<p class="total" aria-live="polite">{items.length} results</p>

<ul>
  {#each sorted as facility (facility.id)}
    <li>
      <button type="button" onclick={() => onselect(facility)}>
        <strong>{facility.properties.name}</strong>
        <span>{facility.properties.municipality}</span>
      </button>
    </li>
  {/each}
</ul>

<style>
  .total {
    margin: var(--space-3) 0 var(--space-1);
    font-weight: 600;
  }

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

  button:hover {
    background: var(--color-surface);
  }

  span {
    font-size: 0.85rem;
    color: var(--color-muted);
  }
</style>
