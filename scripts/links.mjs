import { parseArgs } from 'node:util';

const usage = 'Usage: node scripts/links.mjs gmail [--to a@b.com] --subject "..." --body "..."';

const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  options: {
    to: { type: 'string' },
    subject: { type: 'string' },
    body: { type: 'string' },
  },
});

const [command] = positionals;

if (command !== 'gmail' || args.subject === undefined || args.body === undefined) {
  console.error(usage);
  process.exit(1);
}

const enc = encodeURIComponent;
const link =
  `https://mail.google.com/mail/?view=cm&fs=1&to=${args.to ? enc(args.to) : ''}` +
  `&su=${enc(args.subject)}&body=${enc(args.body)}`;

if (link.length > 2000) {
  console.error(`warning: link is ${link.length} characters (over 2000); Gmail or the browser may truncate it. Shorten the body.`);
}

console.log(link);
