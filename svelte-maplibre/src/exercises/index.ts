import type { Component } from 'svelte';
import { slugify } from '../router';
import BaseMap from './base-map/BaseMap.svelte';
import Clustering from './clustering/Clustering.svelte';
import DataDrivenStyle from './data-driven-style/DataDrivenStyle.svelte';
import GeocoderSearch from './geocoder-search/GeocoderSearch.svelte';
import IntegratedViewer from './integrated-viewer/IntegratedViewer.svelte';
import PopupAndPanel from './popup-and-panel/PopupAndPanel.svelte';
import VisibleArea from './visible-area/VisibleArea.svelte';
import WmsLayer from './wms-layer/WmsLayer.svelte';

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
  exercise('Popup and side panel', PopupAndPanel),
  exercise('ICGC WMS layer', WmsLayer),
  exercise('Geocoder search', GeocoderSearch),
  exercise('Visible area and synced list', VisibleArea),
  exercise('Clustering', Clustering),
  exercise('Integrated viewer', IntegratedViewer),
];
