<script lang="ts">
  import type { FacilityType } from '../../lib/facilities';
  import { FACILITY_TYPES } from '../data-driven-style/style';

  interface Props {
    types: FacilityType[];
    query: string;
  }

  // $bindable: the parent uses bind:types and bind:query, so changes flow back up on their own.
  let { types = $bindable(), query = $bindable() }: Props = $props();
</script>

<fieldset>
  <legend>Type</legend>
  {#each FACILITY_TYPES as type (type.id)}
    <label>
      <input type="checkbox" value={type.id} bind:group={types} />
      <span class="swatch" style:background={type.color}></span>
      {type.label}
    </label>
  {/each}
</fieldset>

<label class="search">
  Search by name or municipality
  <input type="search" bind:value={query} placeholder="e.g. Girona" />
</label>

<style>
  fieldset {
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }

  fieldset label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 2px 0;
  }

  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }

  .search {
    display: grid;
    gap: var(--space-1);
  }

  .search input {
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }
</style>
