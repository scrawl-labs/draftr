import { layoutGraph } from './layout.js';
import { toExcalidraw } from './excalidraw.js';
import { sequenceToExcalidraw } from './sequence.js';
import { toSvg } from './svg.js';
import { lint, type LintReport } from './lint.js';
import { parseMermaid } from './mermaid.js';
import { extractGraph } from './tidy.js';
import type { DiagramInput } from './schema.js';
import { IconLibrary, type IconOptions } from './icons/index.js';
import type { ExcalidrawDoc } from './types.js';

export { layoutGraph, toExcalidraw, sequenceToExcalidraw, toSvg, lint, parseMermaid, extractGraph };
export { formatReport, type LintReport, type Issue, type IssueCode } from './lint.js';
export { parseGraph, parseSequence, GraphSchema, SequenceSchema, KINDS } from './schema.js';
export type { GraphInput, SequenceInput, DiagramInput, Kind } from './schema.js';
export type { ExcalidrawDoc, ExElement, Scene } from './types.js';
export { THEME } from './theme.js';
export { svgToPng } from './render.js';
export { IconLibrary, type Icon, type IconOptions } from './icons/index.js';

export interface BuildOptions {
  /** false: no icons. Otherwise icon folders to add on top of the built-in set (and DRAFTR_ICONS). */
  icons?: false | IconOptions | IconLibrary;
}

const iconLib = (o?: BuildOptions['icons']) => (o === false ? false : o instanceof IconLibrary ? o : new IconLibrary(o ?? {}));

export interface BuildResult { excalidraw: ExcalidrawDoc; svg: string; report: LintReport }

const finish = (excalidraw: ExcalidrawDoc): BuildResult => ({ excalidraw, svg: toSvg(excalidraw), report: lint(excalidraw) });

/** Graph or sequence input -> { excalidraw, svg, report }. */
export async function build(input: DiagramInput | Record<string, unknown>, opts: BuildOptions = {}): Promise<BuildResult> {
  const icons = iconLib(opts.icons);
  if ((input as { type?: string }).type === 'sequence') return finish(sequenceToExcalidraw(input, { icons }));
  return finish(toExcalidraw(await layoutGraph(input, { icons })));
}

/** Mermaid source (flowchart or sequenceDiagram) -> { excalidraw, svg, report }. */
export async function buildMermaid(source: string, opts: BuildOptions = {}): Promise<BuildResult> {
  return build(parseMermaid(source), opts);
}

/** Re-lay out an existing Excalidraw file; returns the clean result plus the lint report of the original. */
export async function tidy(original: ExcalidrawDoc, opts: BuildOptions = {}): Promise<BuildResult & { before: LintReport }> {
  const graph = extractGraph(original);
  if (!graph.nodes?.length) throw new Error('No shapes found to tidy.');
  return { ...(await build(graph, opts)), before: lint(original) };
}
