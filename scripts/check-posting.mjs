import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: { url: { type: 'string' }, company: { type: 'string' }, title: { type: 'string' } },
});

if (!args.url && !(args.company && args.title)) {
  console.error('Usage: node scripts/check-posting.mjs --url "<job url>"\n   or: node scripts/check-posting.mjs --company "Razorpay" --title "Frontend Engineer"');
  process.exit(1);
}

const decodeEntities = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

function htmlToText(html) {
  if (!html) return '';
  let s = decodeEntities(html); // greenhouse double-encodes its content
  s = s.replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, '');
  return decodeEntities(s).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

async function getJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const notFound = (extra = {}) => ({ found: false, board: null, url: null, title: null, company: null, location: null, description: null, ...extra });

// Each board: fetch one job by id, or list all jobs, normalised to the output shape.
const boards = {
  greenhouse: {
    async job(slug, id) {
      const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}`);
      return j?.id ? this.norm(slug, j) : null;
    },
    async list(slug) {
      const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
      return d?.jobs?.map((j) => this.norm(slug, j)) ?? null;
    },
    norm: (slug, j) => ({
      board: 'greenhouse',
      url: j.absolute_url,
      title: j.title,
      company: j.company_name || slug,
      location: j.location?.name ?? null,
      description: htmlToText(j.content),
    }),
  },
  lever: {
    async job(slug, id) {
      const j = await getJson(`https://api.lever.co/v0/postings/${slug}/${id}`);
      return j?.id ? this.norm(slug, j) : null;
    },
    async list(slug) {
      const d = await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
      return Array.isArray(d) ? d.map((j) => this.norm(slug, j)) : null;
    },
    norm: (slug, j) => ({
      board: 'lever',
      url: j.hostedUrl,
      title: j.text,
      company: slug,
      location: j.categories?.location ?? null,
      description: j.descriptionPlain || htmlToText(j.description),
    }),
  },
  ashby: {
    async job(slug, id) {
      const jobs = await this.list(slug);
      return jobs?.find((j) => j.id === id) ?? null;
    },
    async list(slug) {
      const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
      return d?.jobs?.filter((j) => j.isListed !== false).map((j) => this.norm(slug, j)) ?? null;
    },
    norm: (slug, j) => ({
      board: 'ashby',
      id: j.id,
      url: j.jobUrl,
      title: j.title,
      company: slug,
      location: j.location ?? null,
      description: j.descriptionPlain || htmlToText(j.descriptionHtml),
    }),
  },
};

function parseJobUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  const parts = u.pathname.split('/').filter(Boolean);
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
    const slug = parts[0];
    const id = parts[1] === 'jobs' ? parts[2] : u.searchParams.get('gh_jid');
    return slug && id ? { board: 'greenhouse', slug, id } : null;
  }
  if (host === 'jobs.lever.co') return parts[0] && parts[1] ? { board: 'lever', slug: parts[0], id: parts[1] } : null;
  if (host === 'jobs.ashbyhq.com') return parts[0] && parts[1] ? { board: 'ashby', slug: parts[0], id: parts[1] } : null;
  return null;
}

const tokens = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').split(' ').filter(Boolean));
function titleScore(want, have) {
  const A = tokens(want), B = tokens(have);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

function slugGuesses(company) {
  const words = company.toLowerCase().replace(/[^a-z0-9 -]/g, '').split(/\s+/).filter(Boolean);
  return [...new Set([words.join(''), words.join('-'), words[0]])].filter(Boolean);
}

async function byUrl(raw) {
  const p = parseJobUrl(raw);
  if (!p) return notFound({ error: 'unsupported or unrecognised job URL' });
  const job = await boards[p.board].job(p.slug, p.id);
  if (!job) return notFound({ board: p.board, url: raw });
  const { id, ...rest } = job;
  return { found: true, ...rest };
}

async function byCompany(company, title) {
  let best = null;
  for (const slug of slugGuesses(company)) {
    for (const board of Object.values(boards)) {
      const jobs = await board.list(slug);
      if (!jobs?.length) continue;
      for (const j of jobs) {
        const score = titleScore(title, j.title);
        if (!best || score > best.score) best = { score, job: j };
      }
    }
    if (best && best.score >= 0.5) break; // good enough match on this slug
  }
  if (!best || best.score < 0.5) return notFound();
  const { id, ...rest } = best.job;
  return { found: true, ...rest };
}

const result = args.url ? await byUrl(args.url) : await byCompany(args.company, args.title);
console.log(JSON.stringify(result, null, 2));
