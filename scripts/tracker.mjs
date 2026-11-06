import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FILE = 'tracker.json';
const DAY = 864e5;

const usage = `Usage:
  node scripts/tracker.mjs add --job SLUG --person "Name" --channel email|linkedin [--to ADDRESS_OR_URL]
  node scripts/tracker.mjs mark --id ID --status sent|replied
  node scripts/tracker.mjs due --days 5
  node scripts/tracker.mjs followed-up --id ID
  node scripts/tracker.mjs list --job SLUG`;

const fail = (msg) => {
  console.error(`tracker error: ${msg}`);
  process.exit(1);
};

const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  options: {
    job: { type: 'string' },
    person: { type: 'string' },
    channel: { type: 'string' },
    to: { type: 'string' },
    id: { type: 'string' },
    status: { type: 'string' },
    days: { type: 'string' },
  },
});

const [command] = positionals;

function load() {
  if (!existsSync(FILE)) return [];
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8'));
    if (!Array.isArray(data)) throw new Error('not an array');
    return data;
  } catch (err) {
    fail(`${FILE} is not valid JSON array (${err.message})`);
  }
}

const save = (entries) => writeFileSync(FILE, JSON.stringify(entries, null, 2) + '\n');

function find(entries) {
  if (!args.id) fail('--id is required');
  const entry = entries.find((e) => String(e.id) === args.id);
  if (!entry) fail(`no entry with id ${args.id}`);
  return entry;
}

const entries = load();

switch (command) {
  case 'add': {
    if (!args.job || !args.person) fail('--job and --person are required');
    if (!['email', 'linkedin'].includes(args.channel)) fail('--channel must be email or linkedin');
    const entry = {
      id: entries.reduce((max, e) => Math.max(max, Number(e.id) || 0), 0) + 1,
      job: args.job,
      person: args.person,
      channel: args.channel,
      to: args.to ?? null,
      status: 'drafted',
      createdAt: new Date().toISOString(),
      sentAt: null,
      followUps: 0,
    };
    entries.push(entry);
    save(entries);
    console.log(entry.id);
    break;
  }
  case 'mark': {
    if (!['sent', 'replied'].includes(args.status)) fail('--status must be sent or replied');
    const entry = find(entries);
    entry.status = args.status;
    if (args.status === 'sent') entry.sentAt = new Date().toISOString();
    save(entries);
    console.log(JSON.stringify(entry, null, 2));
    break;
  }
  case 'due': {
    const days = Number(args.days);
    if (!args.days || Number.isNaN(days)) fail('--days N is required');
    const cutoff = Date.now() - days * DAY;
    const due = entries.filter(
      (e) => e.channel === 'email' && e.status === 'sent' && e.sentAt && Date.parse(e.sentAt) <= cutoff && (e.followUps ?? 0) < 2,
    );
    console.log(JSON.stringify(due, null, 2));
    break;
  }
  case 'followed-up': {
    const entry = find(entries);
    entry.followUps = (entry.followUps ?? 0) + 1;
    entry.sentAt = new Date().toISOString();
    save(entries);
    console.log(JSON.stringify(entry, null, 2));
    break;
  }
  case 'list': {
    if (!args.job) fail('--job is required');
    console.log(JSON.stringify(entries.filter((e) => e.job === args.job), null, 2));
    break;
  }
  default:
    console.error(usage);
    process.exit(1);
}
