# AI Job Hunter

The scripts behind the video **[Build an AI Job Hunting Team with Claude Code](https://youtu.be/isa55iH8aj4)**: six AI agents that find jobs, research companies, tailor your resume, draft referral emails and LinkedIn messages, and prep you for interviews, all working together in one Discord channel.

The agents' prompts and instructions, plus the Switch Rooms and Discord setup, are in the written notes: **[notes.roadsidecoder.com/notes/claude-code-job-hunting-agents](https://notes.roadsidecoder.com/notes/claude-code-job-hunting-agents)**.

This repo holds the small Node.js tools the agents call. You decide everything; nothing is ever sent for you.

## Setup

You need Node.js 20.12 or newer.

```bash
npm install
cp .env.example .env
mkdir -p jobs
```

Then fill in `.env`:

| Key | Used by | Where to get it |
| --- | --- | --- |
| `JSEARCH_RAPIDAPI_KEY` | `search-jobs` | JSearch on [RapidAPI](https://rapidapi.com) (free tier available) |
| `SERPAPI_KEY` | `search-jobs` | [SerpApi](https://serpapi.com) (free tier available) |
| `HUNTER_API_KEY` | `hunter` | [Hunter.io](https://hunter.io). Optional; needs a work email |

Every key is optional. A script whose key is missing skips that service and says so, so you can start with one.

`.env`, `jobs/` and `tracker.json` (created on first use) are git-ignored, so your keys, your resume and your job data stay on your machine.

## Scripts

| Script | What it does |
| --- | --- |
| `node scripts/search-jobs.mjs --query "frontend developer" --location "Bengaluru" [--days 14]` | Searches JSearch and Google Jobs (via SerpApi) at the same time, merges the results and removes duplicates. Prints JSON. |
| `node scripts/check-posting.mjs --url "<job url>"` or `--company "Acme" --title "Frontend Engineer"` | Checks that a job is still open on Greenhouse, Lever or Ashby and returns the full description. No key needed. |
| `node scripts/hunter.mjs domain --domain acme.com --out jobs/SLUG/hunter.json` | Finds people to contact at a company. Also has `find` and `verify` commands. Saved results are reused to save credits. |
| `node scripts/make-pdf.mjs jobs/SLUG/resume.html` | Renders a resume HTML file to an A4 PDF next to it. |
| `node scripts/links.mjs gmail [--to a@b.com] --subject "..." --body "..."` | Prints a Gmail compose link, so you review and send the email yourself. |
| `node scripts/tracker.mjs add \| mark \| due \| followed-up \| list` | Keeps track of outreach in `tracker.json` and lists follow-ups that are due. |

`scripts/resume-template.html` is a clean one-page resume layout for the agents to fill in.

## Using it with Claude Code

`.claude/settings.json` lets Claude Code run `node scripts/...` commands and use web search, and blocks it from reading `.env`. Open the folder in Claude Code and follow the video and notes to set up the agents.

## License

MIT
