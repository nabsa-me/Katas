# Katas

Coding katas, one self-contained folder per topic. Each kata has its own dependencies and its own README with how to run it.

| Kata                                          | Topic                                                                                  |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| [svelte-maplibre](svelte-maplibre/)           | Web map viewers with Svelte 5 and MapLibre GL JS (8 exercises)                         |
| [react-internals](react-internals/)           | React rendering: referential equality, memoization, context and closures (5 exercises) |
| [nextjs-ssr-hydration](nextjs-ssr-hydration/) | Server rendering and hydration with the Next.js App Router (3 exercises)               |

## Conventions

- **Folder names** describe the stack or topic of the kata, in kebab-case (`svelte-maplibre`).
- **Everything is in English**: code, comments, UI text and READMEs.
- **Commits** follow Conventional Commits with the kata folder as scope: `feat(svelte-maplibre): ...`. Repository-wide changes use the `repo` scope.

## Linting and formatting

ESLint and Prettier are configured at the root and cover every kata.

```bash
npm install            # root tooling only
npm run lint           # ESLint
npm run format:check   # Prettier, check only
npm run format         # Prettier, write
```

Each kata keeps its own dependencies: run `npm install` inside its folder before running or type-checking it.
