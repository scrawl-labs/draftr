import type { Kind } from './schema.js';
import type { Icon } from './icons/index.js';

export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }

export interface SceneNode extends Box { id: string; label: string; kind: Kind; group?: string; highlight?: boolean; icon?: Icon }
export interface SceneGroup extends Box { id: string; label: string; parent?: string; depth: number }
export interface SceneEdge {
  id: string; from: string; to: string; label?: string; style: 'solid' | 'dashed'; highlight?: boolean;
  points: Pt[];
  labelBox?: Box & { text: string };
}
export interface Scene {
  title?: string;
  width: number; height: number;
  nodes: SceneNode[]; groups: SceneGroup[]; edges: SceneEdge[];
  fontSize: number; labelFontSize: number; groupFontSize: number;
}

/** Loose Excalidraw element: we read/write the fields we need and keep the rest. */
export interface ExElement {
  id: string;
  type: string;
  x: number; y: number; width: number; height: number;
  strokeColor: string; backgroundColor: string; strokeWidth: number; strokeStyle: string;
  opacity?: number;
  roundness?: { type: number } | null;
  isDeleted?: boolean;
  text?: string; fontSize?: number; textAlign?: string; lineHeight?: number; containerId?: string | null;
  points?: Array<[number, number]>;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  endArrowhead?: string | null;
  boundElements?: Array<{ type: string; id: string }> | null;
  customData?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface ExcalidrawDoc {
  type: 'excalidraw';
  version: number;
  source?: string;
  elements: ExElement[];
  appState?: { viewBackgroundColor?: string; [k: string]: unknown };
  files?: Record<string, ExFile>;
}

export interface ExFile { id: string; mimeType: string; dataURL: string; created: number }
