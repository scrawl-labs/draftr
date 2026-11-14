// Code → graph extractors: read a codebase, return draftr graph input you can build or refine.
import { extractDeps, type DepsOptions, type Extracted } from './deps.js';
import { extractRoutes } from './routes.js';
import { extractSchema } from './schema.js';

export const EXTRACTORS = {
  deps: 'module dependencies (JS/TS, Python, Go imports)',
  routes: 'HTTP routes (Express/Fastify/Hono/Koa, NestJS, Next.js, FastAPI/Flask, Go)',
  schema: 'database schema (SQL DDL, Prisma, Django models, Rails schema.rb)',
} as const;
export type ExtractorName = keyof typeof EXTRACTORS;
export type ExtractOptions = DepsOptions;

export function extract(kind: ExtractorName, root: string, opts: ExtractOptions = {}): Extracted {
  switch (kind) {
    case 'deps': return extractDeps(root, opts);
    case 'routes': return extractRoutes(root, opts);
    case 'schema': return extractSchema(root);
    default: throw new Error(`unknown extractor "${kind}" (use one of: ${Object.keys(EXTRACTORS).join(', ')})`);
  }
}

export { extractDeps, extractRoutes, extractSchema, type Extracted };
export { findRoutes, type Route } from './routes.js';
export { findSchema, type Table, type ForeignKey } from './schema.js';
