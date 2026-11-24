<script lang="ts">
  import { exercises } from './exercises';
  import { parseHash } from './router';

  let hash = $state(window.location.hash);

  $effect(() => {
    const onHashChange = () => (hash = window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  });

  const current = $derived(exercises.find((e) => e.id === parseHash(hash).id) ?? null);
</script>

<div class="app">
  <nav aria-label="Exercises">
    <h1><a href="#/">Svelte + MapLibre katas</a></h1>
    <ol>
      {#each exercises as exercise (exercise.id)}
        <li>
          <a href="#/{exercise.id}" aria-current={current?.id === exercise.id ? 'page' : undefined}>
            {exercise.title}
          </a>
        </li>
      {/each}
    </ol>
  </nav>

  <main>
    {#if current}
      {@const Exercise = current.component}
      {#key current.id}
        <Exercise />
      {/key}
    {:else}
      <section class="home">
        <p>A repository of scoped experiments for working with MapLibre and Svelte.</p>
      </section>
    {/if}
  </main>
</div>

<style>
  .app {
    display: grid;
    grid-template-columns: 280px 1fr;
    height: 100%;
  }

  nav {
    overflow: auto;
    padding: var(--space-4);
    background: var(--color-surface);
    border-right: 1px solid var(--color-border);
  }

  h1 {
    margin: 0 0 var(--space-4);
    font-size: 1.2rem;
  }

  h1 a {
    color: inherit;
    text-decoration: none;
  }

  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li a {
    display: block;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    color: inherit;
    text-decoration: none;
  }

  li a:hover {
    background: var(--color-border);
  }

  li a[aria-current='page'] {
    background: var(--color-accent);
    color: #fff;
  }

  main {
    position: relative;
    overflow: hidden;
  }

  .home {
    padding: var(--space-5);
    max-width: 60ch;
  }

  @media (max-width: 640px) {
    .app {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }

    nav {
      max-height: 30vh;
      border-right: none;
      border-bottom: 1px solid var(--color-border);
    }
  }
</style>
