import type { Component } from 'svelte';

export interface Exercise {
  id: string;
  title: string;
  component: Component;
}

export const exercises: Exercise[] = [];
