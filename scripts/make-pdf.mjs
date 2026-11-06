import puppeteer from 'puppeteer';
import { existsSync } from 'node:fs';
import { resolve, join, dirname, basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/make-pdf.mjs jobs/SLUG/resume.html');
  process.exit(1);
}

const htmlPath = resolve(input);
if (!existsSync(htmlPath)) {
  console.error(`make-pdf error: file not found: ${input}`);
  process.exit(1);
}

const pdfPath = join(dirname(htmlPath), basename(htmlPath, extname(htmlPath)) + '.pdf');

const browser = await puppeteer.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
  await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true });
} finally {
  await browser.close();
}

// Count pages by reading the PDF's page objects (no dependency needed).
const { readFile } = await import('node:fs/promises');
const raw = (await readFile(pdfPath)).toString('latin1');
const pages = (raw.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;

console.log(JSON.stringify({ pdf: pdfPath, pages }));
