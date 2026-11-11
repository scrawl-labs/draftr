// Generates src/icons/catalog.ts from simple-icons (CC0) and lucide-static (ISC).
// Run: node scripts/build-icons.mjs   (only needed when changing the curated lists)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const si = require('simple-icons');
const lucideDir = new URL('../node_modules/lucide-static/icons/', import.meta.url);

// Curated developer brands (simple-icons slugs). Order doesn't matter.
const BRANDS = `postgresql mysql mariadb sqlite mongodb redis apachecassandra elasticsearch opensearch clickhouse
cockroachlabs neo4j couchbase influxdb timescale supabase firebase planetscale prisma snowflake databricks duckdb
apachekafka rabbitmq apachepulsar apachespark apacheflink apacheairflow docker kubernetes helm podman nginx apache
traefikproxy envoyproxy caddy haproxy cloudflare vercel netlify render railway flydotio digitalocean hetzner
googlecloud alibabacloud terraform pulumi ansible vagrant packer consul vault nomad github gitlab bitbucket git
jenkins circleci githubactions argo travisci buildkite grafana prometheus datadog newrelic sentry elastic kibana
logstash opentelemetry jaeger splunk pagerduty stripe paypal square adyen mailgun mailchimp discord telegram
whatsapp zoom auth0 okta keycloak clerk openid jsonwebtokens react vuedotjs angular svelte nextdotjs nuxt remix
astro vite webpack nodedotjs deno bun typescript javascript python go rust ruby rubyonrails php laravel django
flask fastapi spring springboot dotnet kotlin swift android apple flutter dart graphql apollographql trpc swagger
openapiinitiative postman insomnia redux tailwindcss figma notion jira confluence linear trello anthropic
huggingface langchain ollama pytorch tensorflow jupyter pandas numpy scikitlearn mlflow minio ceph backblaze
dropbox googledrive box shopify wordpress contentful strapi sanity algolia meilisearch mapbox googlemaps
cloudinary fastly akamai jfrog npm pnpm yarn pypi hashicorp istio linkerd cilium etcd apachehadoop apachehive
presto trino metabase looker mixpanel posthog hotjar googleanalytics intercom zendesk hubspot sap visa mastercard
bitcoin ethereum solana ipfs gmail googlebigquery googlepubsub googlecloudstorage firebase cloudflareworkers
upstash neon turso fly temporal celery sidekiq hasura directus keystone medusa storybook cypress playwright jest
vitest selenium sonarcloud snyk dependabot renovate codecov vitess debezium apachenifi apachecamel minikube k3s
rancher openshift portainer vmware proxmox ubuntu debian redhat alpinelinux linux windows macos ios`
  .split(/\s+/).filter(Boolean);

// Extra names people write in labels.
const ALIASES = {
  postgresql: ['postgres', 'pg', 'psql', 'pgsql'], mongodb: ['mongo'], apachekafka: ['kafka'], elasticsearch: ['es'],
  kubernetes: ['k8s', 'kube'], googlecloud: ['gcp', 'gcloud', 'google cloud'], rabbitmq: ['rabbit', 'amqp'],
  nodedotjs: ['node', 'nodejs', 'node.js'], nextdotjs: ['next', 'nextjs', 'next.js'], vuedotjs: ['vue', 'vuejs'],
  githubactions: ['github actions', 'gh actions'], traefikproxy: ['traefik'], envoyproxy: ['envoy'],
  cockroachlabs: ['cockroachdb', 'cockroach'], apachespark: ['spark'], apacheflink: ['flink'], apacheairflow: ['airflow'],
  apachepulsar: ['pulsar'], apachecassandra: ['cassandra'], jsonwebtokens: ['jwt'], openapiinitiative: ['openapi'],
  apollographql: ['apollo'], flydotio: ['fly.io'], timescale: ['timescaledb'], springboot: ['spring boot'],
  dotnet: ['.net', 'asp.net'], opentelemetry: ['otel'], googlebigquery: ['bigquery'], googlepubsub: ['pubsub', 'pub/sub'],
  googlecloudstorage: ['gcs'], cloudflareworkers: ['workers'], apachehadoop: ['hadoop', 'hdfs'], apachehive: ['hive'],
  apachenifi: ['nifi'], apachecamel: ['camel'], typescript: ['ts'], javascript: ['js'], python: ['py'], go: ['golang'],
  rubyonrails: ['rails'], huggingface: ['hf'], mysql: ['aurora mysql'], redis: ['elasticache'], googleanalytics: ['ga4'],
  pagerduty: ['pager duty'], newrelic: ['new relic'], alpinelinux: ['alpine'], redhat: ['rhel'],
};

// Words that are too common to match inside a longer label; they only match a label that is exactly the word.
const EXACT_ONLY = ['go', 'box', 'render', 'square', 'linear', 'apple', 'swift', 'dart', 'spring', 'apache', 'git',
  'bun', 'zoom', 'railway', 'sanity', 'elastic', 'vault', 'consul', 'nomad', 'packer', 'argo', 'helm', 'envoy', 'remix',
  'astro', 'presto', 'temporal', 'keystone', 'medusa', 'neon', 'fly', 'ts', 'js', 'py', 'pg', 'es', 'node', 'next',
  'workers', 'jest', 'hive', 'camel', 'clerk', 'storybook', 'notion', 'linux', 'windows', 'ios', 'vite', 'android', 'flutter'];

// Generic (lucide) icons: name, keywords. First match wins; kinds fall back to KIND_ICONS.
const GENERIC = [
  ['user', ['user', 'users', 'customer', 'shopper', 'actor', 'person', 'buyer', 'admin', 'operator']],
  ['app-window', ['web app', 'webapp', 'browser', 'frontend', 'spa', 'dashboard', 'web']],
  ['smartphone', ['mobile', 'ios app', 'android app', 'phone']],
  ['route', ['gateway', 'api gateway', 'ingress', 'router', 'proxy']],
  ['scale', ['load balancer', 'lb', 'alb', 'elb']],
  ['shopping-cart', ['order', 'orders', 'cart', 'checkout']],
  ['credit-card', ['payment', 'payments', 'billing', 'charge', 'invoice']],
  ['mail', ['mail', 'email', 'smtp', 'newsletter']],
  ['bell', ['notification', 'notifications', 'push', 'alert', 'alerts']],
  ['package', ['inventory', 'stock', 'warehouse', 'shipping', 'fulfillment']],
  ['key-round', ['auth', 'login', 'identity', 'sso', 'oauth', 'token']],
  ['search', ['search', 'index', 'indexer']],
  ['zap', ['cache', 'cdn']],
  ['cog', ['worker', 'workers', 'job', 'jobs', 'cron', 'scheduler', 'consumer']],
  ['bar-chart-3', ['analytics', 'metrics', 'report', 'reports', 'reporting']],
  ['file-text', ['logs', 'log', 'audit']],
  ['image', ['image', 'images', 'media', 'thumbnail']],
  ['brain', ['ml', 'model', 'llm', 'ai', 'inference', 'embedding', 'embeddings']],
  ['message-square', ['chat', 'message', 'messages', 'messaging', 'sms']],
  ['shield', ['security', 'waf', 'firewall', 'policy']],
  ['users', ['team', 'teams', 'org', 'organization']],
  ['calendar', ['calendar', 'booking', 'schedule']],
  ['map-pin', ['location', 'geo', 'maps']],
  ['upload', ['upload', 'uploads', 'ingest', 'ingestion']],
  ['git-branch', ['pipeline', 'ci', 'build', 'deploy']],
  ['terminal', ['cli', 'shell', 'script']],
  ['webhook', ['webhook', 'webhooks', 'callback']],
  ['lock', ['secrets', 'secret', 'kms', 'vault']],
];
const KIND_ICONS = { service: 'server', database: 'database', queue: 'layers', external: 'globe', user: 'user', client: 'monitor', storage: 'hard-drive', decision: 'git-fork', note: 'sticky-note' };

const brands = [];
const seen = new Set();
const bySlug = Object.fromEntries(Object.values(si).map((i) => [i.slug, i]));
for (const slug of BRANDS) {
  const i = bySlug[slug];
  if (!i || seen.has(slug)) continue;
  seen.add(slug);
  brands.push({ slug, title: i.title, hex: i.hex, path: i.path, aliases: ALIASES[slug] ?? [] });
}
brands.sort((a, b) => a.slug.localeCompare(b.slug));

const genericNames = new Set([...GENERIC.map(([n]) => n), ...Object.values(KIND_ICONS),
  // extra plain icons people can ask for by name
  'box', 'boxes', 'cloud', 'cpu', 'globe', 'network', 'server-cog', 'container', 'folder', 'file', 'code', 'link',
  'clock', 'timer', 'activity', 'heart-pulse', 'eye', 'filter', 'git-merge', 'git-pull-request', 'inbox', 'send',
  'radio', 'rss', 'wifi', 'monitor-smartphone', 'tablet', 'laptop', 'building-2', 'store', 'truck', 'wallet',
  'receipt', 'ticket', 'tag', 'star', 'thumbs-up', 'flag', 'book-open', 'graduation-cap', 'video', 'music', 'mic',
  'camera', 'printer', 'cloud-upload', 'cloud-download', 'refresh-cw', 'repeat', 'shuffle', 'split', 'merge',
  'workflow', 'blocks', 'puzzle', 'plug', 'power', 'battery', 'thermometer', 'sun', 'moon', 'table', 'sheet',
  'list-checks', 'list-ordered', 'kanban', 'square-terminal', 'bot', 'sparkles', 'wand-2', 'fingerprint', 'scan-face',
  'qr-code', 'hash', 'at-sign', 'phone', 'headphones', 'life-buoy', 'hard-drive-download', 'archive', 'trash-2',
  'database-zap', 'database-backup', 'cylinder', 'table-2', 'braces', 'variable', 'function-square', 'sigma']);
const generic = {};
for (const name of [...genericNames].sort()) {
  let svg;
  try { svg = readFileSync(new URL(`${name}.svg`, lucideDir), 'utf8'); } catch { continue; }
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s+/g, ' ').trim();
  generic[name] = body;
}
const missingGeneric = [...genericNames].filter((n) => !generic[n]);
if (missingGeneric.length) console.warn('lucide icons not found:', missingGeneric.join(', '));

const out = `// GENERATED by scripts/build-icons.mjs — do not edit by hand.
// Brand icons: Simple Icons (CC0-1.0, https://simpleicons.org). Brand names and logos are trademarks of their owners.
// Generic icons: Lucide (ISC, https://lucide.dev).
/* eslint-disable */
export interface BrandIcon { slug: string; title: string; hex: string; path: string; aliases: string[] }
export const BRANDS: BrandIcon[] = ${JSON.stringify(brands)};
/** Lucide icon bodies (children of a 24x24 stroke-based <svg>). */
export const GENERIC: Record<string, string> = ${JSON.stringify(generic)};
export const GENERIC_KEYWORDS: Array<[string, string[]]> = ${JSON.stringify(GENERIC)};
export const KIND_ICONS: Record<string, string> = ${JSON.stringify(KIND_ICONS)};
export const EXACT_ONLY: string[] = ${JSON.stringify(EXACT_ONLY)};
`;
writeFileSync(new URL('../src/icons/catalog.ts', import.meta.url), out);
console.log(`brands: ${brands.length}, generic: ${Object.keys(generic).length}, ${(out.length / 1024).toFixed(0)} KB`);
