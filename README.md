# Tracker

A small app for tracking progress in areas like sport or language learning, week by week — with long-term phases so you always know what kind of week you are in.

**Live:** https://hi-kay.github.io/tracking-app/

## What it does

- **Areas and phases** — each area (e.g. Sport, Japanese) has a start date and a list of phases. A phase has a name, a length in weeks, a sessions-per-week target and a short focus text (e.g. 4 weeks "Build the routine", then 4 weeks "Increase weight").
- **Activity types** — each area has its own types with a short label and colour, e.g. Strength (S) and Cardio (C) for sport, or Kana, Kanji, Vocabulary and Grammar for Japanese. A day can have several.
- **This week** — shows the current week and phase for every area, what comes next, and lets you log what you did each day and add a note for the week.
- **Overview** — a grid of all weeks of an area (rows) by weekday (columns), grouped by phase, so you can see the pattern and keep it going. A streak counts the weeks in a row where you met the target.
- **Plan** — a timeline of all areas with today's week highlighted, plus how each past week went against its target.
- **Backup** — export and import all data as a JSON file.

Weeks run Monday to Sunday; week 1 is the week containing the start date.

## Data

Everything is stored in the browser's `localStorage`. There is no backend and no account, and nothing is uploaded. Data is separate per browser and device — use Export/Import to move it.

## Run locally

Plain HTML, CSS and JavaScript, no build step:

```bash
python3 -m http.server 5178
```

Then open http://localhost:5178.

## Deploy

GitHub Pages serves the `main` branch directly, so a push to `main` publishes the change.
