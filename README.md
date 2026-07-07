# Personal Control-Theory GitHub Trend Digest

This is a personal research-tool project for tracking GitHub repositories that
matter to control theory, robotics, and autonomous systems. It is a focused
adaptation of
[vitalets/github-trending-repos](https://github.com/vitalets/github-trending-repos),
not a fresh GitHub trend system. The original project already contains the useful
piece for this task: a GitHub Trending page collector that extracts repository
name, description, language, total stars, forks, and daily stars. This fork keeps
that source route and changes the output target from GitHub issue comments to
versioned Markdown files under `daily/`.

The project is scoped for individual use: daily reading, research scouting,
idea triage, and identifying practical control-theory insertion points. It is
not intended to be a general public GitHub Trending clone.

## Route Decision

Selected route: fork/adapt `vitalets/github-trending-repos`.

Rationale:

- GitHub Trending RSS is simple, but RSS entries do not reliably provide forks,
  recent update time, topics, or enough context for control-theory filtering.
- `vitalets/github-trending-repos` already parses GitHub Trending HTML and has a
  daily/weekly automation model. It is the closest base for a domain-specific
  digest.
- `headllines/github-daily` is smaller, but it depends on `trendings.herokuapp.com`
  and writes locked GitHub issues through GitHub App credentials. This project
  needs repository Markdown files, so that base would require removing most of
  the workflow.
- RSSBrew is useful as a later aggregation and AI-summary layer. It is not the
  chosen source of record because the required repository metrics should come
  from GitHub Trending and the GitHub API.

## What Was Added

- `config/control-keywords.json`: domain keywords, aliases, weights, theory
  rationale, and insertion-point templates.
- `scripts/generate-daily.mjs`: daily collector, GitHub API enrichment, keyword
  matcher, priority scorer, and Markdown renderer.
- `.github/workflows/daily.yml`: scheduled GitHub Actions job that writes and
  commits `daily/YYYY-MM-DD.md`.

## Keyword Scope

The digest filters for:

- ROS2
- Gazebo
- robotics
- trajectory tracking
- MPC
- CBF
- Lyapunov
- optimization
- control toolbox
- autonomous driving
- simulation
- state estimation
- observer
- digital twin

Each output repository includes:

- repo name
- stars/forks/language/recent update
- matched keywords
- one-line summary
- why it matters for control theory
- possible theory insertion point
- whether Codex can turn it into a practical project
- priority: high / medium / low

## Daily Output

Run locally:

```bash
node scripts/generate-daily.mjs
```

Run for a specific date:

```bash
node scripts/generate-daily.mjs --date 2026-07-06
```

Preview without writing a file:

```bash
node scripts/generate-daily.mjs --dry-run
```

The generated file is:

```text
daily/YYYY-MM-DD.md
```

The Markdown digest is rendered in Chinese by default for personal reading.
Repository names, links,
metrics, and language are preserved as source metadata; field labels,
one-line summaries, control-theory rationale, theory insertion points, Codex
practicality judgments, and priority labels are localized. If GitHub does not
provide a useful repository description, the generator reads the repository
README and derives a Chinese one-line summary before rendering the daily digest.

## GitHub Actions

The workflow runs every day at `23:30 UTC`, which is `07:30` in Singapore. It:

1. checks out the repository;
2. runs `node scripts/generate-daily.mjs`;
3. builds a static reading site under `public/`;
4. deploys the site to GitHub Pages;
5. commits `daily/YYYY-MM-DD.md` and `public/` when files changed;
6. optionally sends a short webhook notification.

The default `GITHUB_TOKEN` is enough for public repository metadata and for
committing the generated digest back to the repository.

## Recommended Reading Flow

Markdown is kept as the auditable source format, but it is not the main personal
reading surface. The recommended setup is GitHub Pages plus RSS:

- `public/index.html`: latest digest dashboard with compact cards.
- `public/daily/YYYY-MM-DD.html`: full daily reading page.
- `public/feed.xml`: RSS feed for Feedly, Inoreader, NetNewsWire, FreshRSS, or
  any RSS reader.
- `public/daily/YYYY-MM-DD.md`: Markdown source mirrored into the Pages artifact.

Enable GitHub Pages with **Build and deployment: GitHub Actions** in the
repository settings. After the workflow runs, the GitHub Pages URL becomes the
daily reading entrypoint.

Optional push notifications:

- Slack: set `SLACK_WEBHOOK_URL`.
- Telegram: set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
- Generic webhook: set `GENERIC_WEBHOOK_URL`.

Notifications only send the title and reading link. The full digest stays on
the web page and RSS feed, which keeps chat messages short and readable.

## How The Digest Avoids Copying Generic Trending

The pipeline uses GitHub Trending only as the candidate pool. It then:

1. enriches each repository with GitHub API metadata;
2. checks domain-specific aliases in name, description, topics, and README;
3. scores direct control-theory terms higher than broad robotics/simulation terms;
4. adds a small GitHub Search supplement for recently updated repositories that
   match the configured control keywords;
5. renders only repositories with at least one configured control-theory match.
