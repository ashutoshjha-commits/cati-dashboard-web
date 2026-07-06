# CATI Control Tower — Dashboards

Static, no-build web dashboard. Deployed via GitHub Pages. Pulls live data
client-side from each project's published Google Sheets CSV link (no backend,
no data stored in this repo).

## Structure

```
index.html            landing page — links to each project
assets/
  style.css           shared design tokens + component styles (light/dark)
  engine.js           shared engine: fetch CSV, compute KPIs, render charts
  theme.js            light/dark toggle button logic
projects/
  manipur/
    config.js         Manipur's data source, target/dates, column names
    index.html         loads style.css + engine.js + this config, then renders
  goa/                 (add later — same shape as manipur/)
  <candidate-survey>/  (add later — same shape as manipur/)
```

## Adding a new project (e.g. Goa)

1. Copy `projects/manipur/` to `projects/goa/`.
2. Edit `projects/goa/config.js` only: `csvUrl`, `target`, `startDate`,
   `deadline`, and `columns` (map to that sheet's actual header names).
3. Add a link to it in the root `index.html`'s project list.

Nothing in `assets/` needs to change, and editing `goa/config.js` cannot break
`manipur/config.js` or any other project — they're fully isolated files.

## Local preview

```
cd cati-dashboard
python -m http.server 8000
```
Then open `http://localhost:8000/`.

## Deploying

Push this folder to a GitHub repo, then enable **Settings → Pages → Deploy
from branch** (root, or `/cati-dashboard` if it's a subfolder of a bigger
repo). No build step, no server, no secrets — it's plain static files.

## Notes

- Dates in the `Timestamp` column are parsed manually as `dd/mm/yyyy`
  (`engine.js`'s `parseDMY`) rather than via `Date.parse`/locale-aware
  parsing, because the spreadsheet's locale previously caused a silent
  day/month swap bug in a Sheets `COUNTIF` formula — same risk applies to
  naive JS date parsing, so it's avoided here too.
- Constituency (AC) and party-swing charts filter to `Final Call = Valid`
  only — junk placeholder values (e.g. `AC = "NO"`) are ~99% attached to
  invalid calls, so this filter cleans them without any manual data editing.
