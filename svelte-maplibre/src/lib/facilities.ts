import type { Feature, FeatureCollection, Point } from 'geojson';
import data from '../data/facilities.json';

export type FacilityType = 'library' | 'school' | 'health_center' | 'sports_center';

export interface FacilityProps {
  name: string;
  type: FacilityType;
  capacity: number;
  municipality: string;
}

export type Facility = Feature<Point, FacilityProps>;
export type FacilityCollection = FeatureCollection<Point, FacilityProps>;

/** Fictional facilities in EPSG:4326 (lon, lat). */
export const facilities = data as FacilityCollection;
