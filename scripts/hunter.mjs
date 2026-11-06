import { parseArgs } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

try { process.loadEnvFile(); } catch {}

const [command, ...rest] = process.argv.slice(2);
const { values: args } = parseArgs({
  args: rest,
  options: {
    domain: { type: 'string' },
    first: { type: 'string' },
    last: { type: 'string' },
    email: { type: 'string' },
    out: { type: 'string' },
  },
});

const usage = `Usage:
  node scripts/hunter.mjs domain --domain razorpay.com [--out jobs/SLUG/hunter.json]
  node scripts/hunter.mjs find --domain razorpay.com --first Rahul --last Sharma
  node scripts/hunter.mjs verify --email rahul.sharma@razorpay.com`;

const required = { domain: ['domain'], find: ['domain', 'first', 'last'], verify: ['email'] }[command];
if (!required || required.some((k) => !args[k])) {
  console.error(usage);
  process.exit(1);
}

const fail = (msg) => {
  console.error(`hunter error: ${msg}`);
  process.exit(1);
};

// A cached --out file saves credits, and needs no key.
if (command === 'domain' && args.out && existsSync(args.out)) {
  console.log(readFileSync(args.out, 'utf8').trim());
  process.exit(0);
}

const key = process.env.HUNTER_API_KEY;
if (!key) {
  console.log(JSON.stringify({ enabled: false }));
  process.exit(0);
}

async function hunter(path, params) {
  const url = `https://api.hunter.io/v2/${path}?${new URLSearchParams({ ...params, api_key: key })}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  } catch (err) {
    fail(`could not reach Hunter (${err.message})`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body.errors?.[0];
    const detail = e?.details || res.statusText;
    if (res.status === 429 || e?.id === 'usage_limit_reached' || /limit|credit/i.test(detail)) {
      fail(`out of credits or rate limited (HTTP ${res.status}: ${detail})`);
    }
    if (res.status === 401) fail(`HUNTER_API_KEY was rejected (${detail})`);
    fail(`HTTP ${res.status}: ${detail}`);
  }
  return body.data ?? {};
}

let result;

if (command === 'domain') {
  const d = await hunter('domain-search', { domain: args.domain, department: 'it', limit: '10' });
  result = {
    organization: d.organization ?? null,
    pattern: d.pattern ?? null,
    acceptAll: d.accept_all ?? null,
    people: (d.emails ?? []).map((e) => ({
      firstName: e.first_name ?? null,
      lastName: e.last_name ?? null,
      position: e.position ?? null,
      email: e.value ?? null,
      confidence: e.confidence ?? null,
      linkedin: e.linkedin ?? null,
    })),
  };
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(result, null, 2));
  }
} else if (command === 'find') {
  const d = await hunter('email-finder', { domain: args.domain, first_name: args.first, last_name: args.last });
  result = { email: d.email ?? null, score: d.score ?? null };
} else {
  const d = await hunter('email-verifier', { email: args.email });
  result = { email: d.email ?? args.email, status: d.status ?? null, score: d.score ?? null };
}

console.log(JSON.stringify(result, null, 2));
