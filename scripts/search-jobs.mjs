import { parseArgs } from 'node:util';

try { process.loadEnvFile(); } catch {}

const { values: args } = parseArgs({
  options: {
    query: { type: 'string' },
    location: { type: 'string' },
    days: { type: 'string' },
  },
});

if (!args.query || !args.location) {
  console.error('Usage: node scripts/search-jobs.mjs --query "frontend developer" --location "Bengaluru" [--days 14]');
  process.exit(1);
}

const days = args.days ? Number(args.days) : null;
const warn = (msg) => console.error(`warning: ${msg}`);

const STATES = {
  bengaluru: 'Karnataka', bangalore: 'Karnataka', mysuru: 'Karnataka', mysore: 'Karnataka',
  mumbai: 'Maharashtra', pune: 'Maharashtra', nagpur: 'Maharashtra', thane: 'Maharashtra',
  delhi: 'Delhi', 'new delhi': 'Delhi', gurugram: 'Haryana', gurgaon: 'Haryana', faridabad: 'Haryana',
  noida: 'Uttar Pradesh', ghaziabad: 'Uttar Pradesh', lucknow: 'Uttar Pradesh',
  hyderabad: 'Telangana', chennai: 'Tamil Nadu', coimbatore: 'Tamil Nadu',
  kolkata: 'West Bengal', ahmedabad: 'Gujarat', surat: 'Gujarat', jaipur: 'Rajasthan',
  kochi: 'Kerala', thiruvananthapuram: 'Kerala', indore: 'Madhya Pradesh', bhopal: 'Madhya Pradesh',
  chandigarh: 'Chandigarh', bhubaneswar: 'Odisha', visakhapatnam: 'Andhra Pradesh',
};

const clean = (v) => (v === undefined || v === null || v === '' ? null : v);

function datePostedParam(d) {
  if (d === null || d > 7) return 'month';
  if (d <= 1) return 'today';
  if (d <= 3) return '3days';
  return 'week';
}

function formatSalary(min, max, cur, period) {
  if (!min && !max) return null;
  const range = min && max && min !== max ? `${min}-${max}` : `${min || max}`;
  return [cur, range, period && `per ${String(period).toLowerCase()}`].filter(Boolean).join(' ');
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!res.ok) {
    const detail = body?.error?.message || body?.error || body?.message || res.statusText;
    const err = new Error(`HTTP ${res.status}: ${String(detail).slice(0, 120)}`);
    err.status = res.status;
    throw err;
  }
  return body ?? {};
}

function failReason(err) {
  if (err.status === 429 || /quota|limit|exceeded/i.test(err.message)) return `quota exhausted or rate limited (${err.message})`;
  if (err.status === 401 || err.status === 403) return `rejected the key (${err.message})`;
  return err.message;
}

async function searchJSearch() {
  const key = process.env.JSEARCH_RAPIDAPI_KEY;
  if (!key) throw Object.assign(new Error('no JSEARCH_RAPIDAPI_KEY set'), { skip: true });
  const headers = { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' };
  const jobs = [];
  let cursor = null;
  for (let page = 0; page < 2; page++) {
    const params = new URLSearchParams({
      query: `${args.query} in ${args.location}`,
      country: 'in',
      date_posted: datePostedParam(days),
    });
    if (cursor) params.set('cursor', cursor);
    let data;
    try {
      data = await getJson(`https://jsearch.p.rapidapi.com/search-v2?${params}`, headers);
    } catch (err) {
      if (page === 0) throw err;
      warn(`jsearch page 2 failed: ${failReason(err)}`);
      break;
    }
    jobs.push(...(data.data?.jobs ?? []));
    cursor = data.data?.cursor;
    if (!cursor) break;
  }
  return jobs.map((j) => ({
    title: clean(j.job_title),
    company: clean(j.employer_name),
    location: clean(j.job_location) || [j.job_city, j.job_state].filter(Boolean).join(', ') || null,
    remote: !!j.job_is_remote,
    salary: formatSalary(j.job_min_salary, j.job_max_salary, j.job_salary_currency, j.job_salary_period),
    postedAt: clean(j.job_posted_at_datetime_utc),
    url: clean(j.job_apply_link),
    source: clean(j.job_publisher),
    api: 'jsearch',
    companyWebsite: clean(j.employer_website),
    _desc: j.job_description || '',
  }));
}

function stripUtm(link) {
  if (!link) return null;
  try {
    const u = new URL(link);
    for (const k of [...u.searchParams.keys()]) if (k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return link;
  }
}

async function searchSerp() {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw Object.assign(new Error('no SERPAPI_KEY set'), { skip: true });
  const city = args.location.trim();
  const state = STATES[city.toLowerCase()];
  const jobs = [];
  let token = null;
  for (let page = 0; page < 2; page++) {
    const params = new URLSearchParams({
      engine: 'google_jobs',
      q: args.query,
      location: [city, state, 'India'].filter(Boolean).join(', '),
      gl: 'in',
      hl: 'en',
      api_key: key,
    });
    if (token) params.set('next_page_token', token);
    let data;
    try {
      data = await getJson(`https://serpapi.com/search.json?${params}`);
      if (data.error && !data.jobs_results) {
        if (page > 0 || /hasn't returned any results/i.test(data.error)) break;
        throw new Error(data.error);
      }
    } catch (err) {
      if (page === 0) throw err;
      warn(`serpapi page 2 failed: ${failReason(err)}`);
      break;
    }
    jobs.push(...(data.jobs_results ?? []));
    token = data.serpapi_pagination?.next_page_token;
    if (!token) break;
  }
  return jobs.map((j) => ({
    title: clean(j.title),
    company: clean(j.company_name),
    location: clean(j.location),
    remote: !!j.detected_extensions?.work_from_home,
    salary: clean(j.detected_extensions?.salary),
    postedAt: clean(j.detected_extensions?.posted_at),
    url: stripUtm(j.apply_options?.[0]?.link || j.share_link),
    source: clean(j.via)?.replace(/^via\s+/i, '') ?? null,
    api: 'serpapi',
    companyWebsite: null,
    _desc: j.description || '',
  }));
}

// ---- dedupe ----
const normCompany = (s) =>
  (s || '').toLowerCase().replace(/\b(pvt|private|ltd|limited|inc|llc|llp|technologies|technology|india)\b/g, '').replace(/[^a-z0-9]/g, '');
const titleTokens = (s) => new Set((s || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').split(' ').filter(Boolean));

function similarTitle(a, b) {
  const A = titleTokens(a), B = titleTokens(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter) >= 0.7;
}

const FIELDS = ['location', 'salary', 'postedAt', 'url', 'source', 'companyWebsite'];
const detailScore = (j) =>
  FIELDS.filter((k) => j[k]).length + (j.remote ? 1 : 0) + Math.min(j._desc.length / 1000, 3);

function dedupe(list) {
  const kept = [];
  let dupes = 0, crossApi = 0;
  for (const job of list) {
    const c = normCompany(job.company);
    const idx = kept.findIndex((k) => c && normCompany(k.company) === c && similarTitle(k.title, job.title));
    if (idx === -1) { kept.push(job); continue; }
    dupes++;
    const existing = kept[idx];
    const sameApi = existing.api === job.api;
    if (!sameApi) crossApi++;
    const winner = detailScore(job) > detailScore(existing) ? job : existing;
    const loser = winner === job ? existing : job;
    for (const k of FIELDS) winner[k] ||= loser[k]; // fill gaps from the other version
    winner.remote ||= loser.remote;
    winner.api = sameApi ? winner.api : 'both';
    kept[idx] = winner;
  }
  return { kept, dupes, crossApi };
}

function tooOld(job) {
  if (days === null || !job.postedAt) return false;
  const iso = Date.parse(job.postedAt);
  if (!Number.isNaN(iso)) return Date.now() - iso > days * 864e5;
  const m = job.postedAt.match(/(\d+)\s*(hour|day|week|month)/i);
  if (!m) return false;
  const per = { hour: 1 / 24, day: 1, week: 7, month: 30 }[m[2].toLowerCase()];
  return Number(m[1]) * per > days;
}

const [js, serp] = await Promise.allSettled([searchJSearch(), searchSerp()]);
const results = [];
const counts = {};
for (const [name, r] of [['jsearch', js], ['serpapi', serp]]) {
  if (r.status === 'fulfilled') {
    counts[name] = r.value.length;
    results.push(...r.value);
  } else {
    counts[name] = null;
    warn(`${name} skipped: ${r.reason.skip ? r.reason.message : failReason(r.reason)}`);
  }
}

if (js.status === 'rejected' && serp.status === 'rejected') {
  warn('both APIs failed; returning an empty array');
}

const { kept, dupes, crossApi } = dedupe(results.filter((j) => j.title && j.company));
const output = kept.filter((j) => !tooOld(j)).map(({ _desc, ...rest }) => rest);

console.error(
  `stats: jsearch=${counts.jsearch ?? 'n/a'} serpapi=${counts.serpapi ?? 'n/a'} duplicates_removed=${dupes} (cross-api=${crossApi}) returned=${output.length}`,
);
console.log(JSON.stringify(output, null, 2));
