# CATI Dashboard — How it works (technical brief)

A one-page read on the mechanics: where data comes from, when it refreshes,
what each file does, and how to reuse it for another project (Goa, etc.).

---

## 1. Data flow

```
 Vendor call sheets
        │  (your existing consolidation — separate scripts)
        ▼
 Master "Samples" tab  in Google Sheets
        │  File → Share → Publish to web → CSV
        ▼
 Published CSV link  (the gid=... URL in config.js)
        │  fetched in the browser (PapaParse)
        ▼
 Dashboard  (charts computed client-side, in the visitor's browser)
```

Nothing is stored on a server. The dashboard is just static files
(HTML/CSS/JS). All the numbers are computed **in the browser** each time it
loads, straight from the published CSV. No database, no backend, no data copied
into the repo.

---

## 2. Does it update on its own?

**On page load / refresh: yes. While sitting open: no.**

- Every time the page is opened or refreshed (F5), it re-fetches the CSV and
  recomputes everything. So "refresh the page → latest data."
- It does **not** poll while left open — an open tab shows the data from when it
  was loaded. (An auto-refresh timer, e.g. re-fetch every 5 minutes, is a
  one-line add if you want it — just ask.)
- **Google's own cache delay:** the "Publish to web" CSV is cached by Google and
  can lag the live sheet by roughly a few minutes (commonly up to ~5, sometimes
  more). So the dashboard is "near-real-time," not instant. This is a Google
  limitation, not the dashboard's.

**Requirement:** the master sheet must stay **Published to web**. If someone
un-publishes it, the CSV link dies and the dashboard shows a red "Could not load
data" box.

---

## 3. What each file does

```
cati-dashboard/
├─ index.html                 Landing page — links to each project.
├─ assets/
│  ├─ style.css               All styling + design tokens (light/dark colors,
│  │                          spacing). Shared by every project.
│  ├─ engine.js               THE brain. Fetch CSV → compute KPIs → draw every
│  │                          chart. Filter bar + "Cut by" logic live here.
│  │                          Project-agnostic: reads column names from config.
│  └─ theme.js                Light/dark toggle button.
└─ projects/
   └─ manipur/
      ├─ config.js            Manipur-specific settings ONLY: the CSV link,
      │                       target, start/deadline dates, and the map of
      │                       column header names. ~30 lines.
      └─ index.html           Loads style.css + engine.js + this config, then
                              calls CATIEngine.render(config).
```

The important separation: **`engine.js` and `style.css` never contain anything
Manipur-specific.** Everything that is project-specific lives in that project's
`config.js`. That's what makes it reusable and safe (see §5).

---

## 4. How the charts are computed

- **KPI tiles** — counts over the filtered rows. "Valid Rate" etc. use the
  filtered set *including* invalid rows as the denominator; the target/dates come
  from `config.js`.
- **Sample Composition** — for each of Gender / Age band / Caste / AC, it counts
  each category and shows it as a % of rows that have a value for that variable.
  Age is bucketed into bands (18–25, 26–35, 36–45, 46–60, 60+) in code.
- **Cross-Tabulation ("Cut by X")** — this is a *banner table*. It groups the
  rows by the dimension you pick (Vendor, Agent, AC, Gender, Age band, Caste,
  Form, Date), then for each measure (Vote Now, 2022 AE, 2024 GE, Gender, Age,
  Caste) draws a **100%-stacked bar per group** — i.e. the composition within
  each group. Hover a segment for the exact count and group size (n=…).
- **Colors follow the entity, not the rank.** Each party keeps one fixed color
  across all three vote columns (INC, BJP, …), so a filter that changes which
  parties appear never repaints the survivors. `RPI(A)` and `RPoI(A)` are treated
  as different entities on purpose (they mean different things in AE vs GE).
- **Readability caps** — a "Cut by" dimension with many categories (e.g. 52
  agents, 40 ACs) shows the top 12 by volume and folds the rest into one
  "Other (N)" row, so no chart becomes an unreadable hairball.

### Date handling (a deliberate choice)
Dates in the `Timestamp` column are parsed manually as `dd/mm/yyyy`
(`parseDMY` in engine.js), **not** with `Date.parse`/locale parsing. This is
because the same data previously caused a silent day↔month swap in a Google
Sheets formula; naive JS date parsing has the identical risk, so it's avoided.

---

## 5. Reusing it for Goa (or any project)

**If Goa is the same kind of political poll** (same style of columns — vendor,
agent, AC, gender, age, the three vote columns, caste, QC columns):

> **Effort: ~10–15 minutes, config only. Zero code changes.**

1. Copy `projects/manipur/` → `projects/goa/`.
2. In `projects/goa/config.js`, change:
   - `csvUrl` → Goa sheet's published CSV link
   - `target`, `startDate`, `deadline`
   - `columns` → map to Goa sheet's actual header names (only if they differ)
   - `validValue` (if Goa marks valid rows differently)
3. Add a link to `projects/goa/` in the root `index.html`.

That's it. Because Goa gets its own `config.js` file, **editing it cannot break
Manipur** — they share no editable state, only the read-only engine.

**If the "candidate survey" is a genuinely different questionnaire** (different
questions, no 2022 AE/2024 GE columns, different measures to cross-tab), then the
list of *measures* and *composition fields* — currently written for the
political-poll columns inside `engine.js` — would need to be made config-driven
too. That's a one-time ~1–2 hour refactor I can do so that *any* survey becomes
pure-config. Worth doing once before you add the candidate survey; not needed for
Goa if Goa mirrors Manipur.

---

## 6. Local preview

```
cd cati-dashboard
python -m http.server 8000
```
Open `http://localhost:8000/`. (Opening the HTML file directly with `file://`
won't work — the CSV fetch needs to be served over http.)
