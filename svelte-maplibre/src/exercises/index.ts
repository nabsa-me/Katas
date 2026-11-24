import type { Component } from 'svelte';
import { slugify } from '../router';
import BaseMap from './base-map/BaseMap.svelte';
import DataDrivenStyle from './data-driven-style/DataDrivenStyle.svelte';

export interface Exercise {
  id: string;
  title: string;
  component: Component;
}

/** The route id is generated from the title, so it is always descriptive and unique per title. */
function exercise(title: string, component: Component): Exercise {
  return { id: slugify(title), title, component };
}

export const exercises: Exercise[] = [
  exercise('Base map and controls', BaseMap),
  exercise('Data-driven style', DataDrivenStyle),
];
