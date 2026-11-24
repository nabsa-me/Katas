import type { ComponentType } from 'react';

export interface Exercise {
  id: string;
  title: string;
  component: ComponentType;
}

export const exercises: Exercise[] = [];
