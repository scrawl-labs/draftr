import { layoutGraph } from './layout.js';
import { toExcalidraw } from './excalidraw.js';
import { toDrawio } from './drawio.js';
import { toTldraw } from './tldraw.js';
import { graphModel, type DiagramModel } from './model.js';
import { modelToSvg } from './model-svg.js';
import { sequenceModel } from './sequence.js';
import { toSvg } from './svg.js';
import { lint, type LintReport } from './lint.js';
import { parseMermaid } from './mermaid.js';
import { extractGraph } from './tidy.js';
import type { DiagramInput } from './schema.js';
import { IconLibrary, type IconOptions } from './icons/index.js';
import type { ExcalidrawDoc } from './types.js';

export { resolveIcon, type MermaidOptions } from './mermaid.js';
export { layoutGraph, toExcalidraw, toDrawio, toTldraw, toSvg, modelToSvg, graphModel, sequenceModel, lint, parseMermaid, extractGraph };
export { formatReport, type LintReport, type Issue, type IssueCode } from './lint.js';
export { parseGraph, parseSequence, GraphSchema, SequenceSchema, KINDS } from './schema.js';
export type { GraphInput, SequenceInput, DiagramInput, Kind } from './schema.js';
export type { ExcalidrawDoc, ExElement, Scene } from './types.js';
export type { DiagramModel, DNode, DEdge, DGroup } from './model.js';
export { THEME } from './theme.js';
export { svgToPng } from './render.js';
export { IconLibrary, type Icon, type IconOptions } from './icons/index.js';

/** Editable formats draftr can write. SVG and PNG are always available alongside. */
export const FORMATS = {
  excalidraw: { ext: '.excalidraw', label: 'Excalidraw (excalidraw.com, VS Code, Obsidian)' },
  drawio: { ext: '.drawio', label: 'draw.io / diagrams.net (desktop, web, Confluence, VS Code)' },
  tldraw: { ext: '.tldr', label: 'tldraw (tldraw.com, VS Code)' },
} as const;
export type Format = keyof typeof FORMATS;
export const FORMAT_NAMES = Object.keys(FORMATS) as Format[];

export interface BuildOptions {
  /** false: no icons. Otherwise icon folders to add on top of the built-in set (and DRAFTR_ICONS). */
  icons?: false | IconOptions | IconLibrary;
  /** Editable output format. Default: excalidraw. */
  format?: Format;
}

export interface BuildResult {
  model: DiagramModel;
  /** Always produced: it is what the linter checks. */
  excalidraw: ExcalidrawDoc;
  /** Docs-quality SVG (Pretendard embedded). */
  svg: string;
  report: LintReport;
  /** The editable file in the requested format. */
  file: { format: Format; ext: string; content: string };
}

const iconLib = (o?: BuildOptions['icons']) => (o === false ? false : o instanceof IconLibrary ? o : new IconLibrary(o ?? {}));

export function exportModel(model: DiagramModel, format: Format, excalidraw = toExcalidraw(model)): string {
  switch (format) {
    case 'excalidraw': return JSON.stringify(excalidraw, null, 2);
    case 'drawio': return toDrawio(model, model.title ?? 'draftr');
    case 'tldraw': return toTldraw(model, model.title ?? 'draftr');
    default: throw new Error(`unknown format "${format}" (use one of: ${FORMAT_NAMES.join(', ')})`);
  }
}

export function finish(model: DiagramModel, format: Format = 'excalidraw'): BuildResult {
  if (!FORMATS[format]) throw new Error(`unknown format "${format}" (use one of: ${FORMAT_NAMES.join(', ')})`);
  const excalidraw = toExcalidraw(model);
  return {
    model, excalidraw, svg: modelToSvg(model), report: lint(excalidraw),
    file: { format, ext: FORMATS[format].ext, content: exportModel(model, format, excalidraw) },
  };
}

/** Graph or sequence input -> model -> { excalidraw, svg, report, file }. */
export async function build(input: DiagramInput | Record<string, unknown>, opts: BuildOptions = {}): Promise<BuildResult> {
  const icons = iconLib(opts.icons);
  const model = (input as { type?: string }).type === 'sequence' ? sequenceModel(input, { icons }) : await graphModel(input, { icons });
  return finish(model, opts.format);
}

/** Mermaid source (flowchart or sequenceDiagram) -> build result. */
export async function buildMermaid(source: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const icons = iconLib(opts.icons);
  return build(parseMermaid(source, { icons }), { ...opts, icons });
}

/** Re-lay out an existing Excalidraw file; returns the clean result plus the lint report of the original. */
export async function tidy(original: ExcalidrawDoc, opts: BuildOptions = {}): Promise<BuildResult & { before: LintReport }> {
  const graph = extractGraph(original);
  if (!graph.nodes?.length) throw new Error('No shapes found to tidy.');
  return { ...(await build(graph, opts)), before: lint(original) };
}
