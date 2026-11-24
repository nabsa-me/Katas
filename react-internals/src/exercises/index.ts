import type { ComponentType } from 'react';
import { slugify } from '../router';
import { UseMemoInlineObject } from './usememo-inline-object/UseMemoInlineObject';

export interface Exercise {
  id: string;
  title: string;
  component: ComponentType;
}

/** The route id is generated from the title, so it is always descriptive and unique per title. */
function exercise(title: string, component: ComponentType): Exercise {
  return { id: slugify(title), title, component };
}

export const exercises: Exercise[] = [exercise('useMemo with an inline object dependency', UseMemoInlineObject)];
