import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'config', 'control-keywords.json');
const DAILY_DIR = path.join(ROOT, 'daily');

const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
const site = config.site || {};
const title = site.title || '控制理论导向 GitHub 趋势日报';
const description = site.description || '面向控制理论的 GitHub 趋势摘要。';
const publicDir = path.join(ROOT, site.outputDir || 'public');
const baseUrl = normalizeBaseUrl(process.env.DIGEST_SITE_URL || site.baseUrl || inferGitHubPagesUrl());

const issues = await loadDailyIssues();
await fs.rm(publicDir, {recursive: true, force: true});
await fs.mkdir(path.join(publicDir, 'daily'), {recursive: true});
await fs.mkdir(path.join(publicDir, 'assets'), {recursive: true});

await fs.writeFile(path.join(publicDir, '.nojekyll'), '', 'utf8');
await fs.writeFile(path.join(publicDir, 'assets', 'styles.css'), renderCss(), 'utf8');
await fs.writeFile(path.join(publicDir, 'index.html'), renderIndex(issues), 'utf8');
await fs.writeFile(path.join(publicDir, 'feed.xml'), renderRss(issues), 'utf8');

for (const issue of issues) {
  await fs.writeFile(path.join(publicDir, 'daily', `${issue.date}.html`), renderDaily(issue), 'utf8');
  await fs.writeFile(path.join(publicDir, 'daily', `${issue.date}.md`), issue.markdown, 'utf8');
}

console.log(`Built ${path.relative(ROOT, publicDir)}`);

async function loadDailyIssues() {
  const files = await fs.readdir(DAILY_DIR).catch(() => []);
  const markdownFiles = files
    .filter(file => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
    .sort()
    .reverse();

  const issues = [];
  for (const file of markdownFiles) {
    const markdown = await fs.readFile(path.join(DAILY_DIR, file), 'utf8');
    const date = file.replace(/\.md$/, '');
    issues.push(parseDailyMarkdown(date, markdown));
  }
  return issues;
}

function parseDailyMarkdown(date, markdown) {
  const repoBlocks = markdown.split(/\n(?=## \d+\. )/).slice(1);
  const repos = repoBlocks.map(parseRepoBlock).filter(Boolean);
  const candidateCount = valueFromLine(markdown, '候选仓库数') || '';
  const selectedCount = valueFromLine(markdown, '入选仓库数') || String(repos.length);

  return {
    date,
    markdown,
    candidateCount,
    selectedCount,
    repos
  };
}

function parseRepoBlock(block) {
  const heading = block.match(/^##\s+\d+\.\s+\[([^\]]+)]\(([^)]+)\)/);
  if (!heading) return null;
  const metrics = valueFromLine(block, 'stars/forks/语言/最近更新');
  const [stars = '0', forks = '0', language = '未知', updated = '未知'] = metrics
    ? metrics.split('/').map(part => part.trim())
    : [];

  return {
    name: heading[1],
    url: heading[2],
    repoName: valueFromLine(block, '仓库名称') || heading[1],
    stars,
    forks,
    language,
    updated,
    keywords: splitList(valueFromLine(block, '匹配关键词')),
    summary: valueFromLine(block, '一句话摘要') || '',
    theory: valueFromLine(block, '对控制理论的意义') || '',
    insertion: valueFromLine(block, '可插入的理论点') || '',
    codex: valueFromLine(block, 'Codex 是否能转成实践项目') || '',
    priority: valueFromLine(block, '优先级') || '',
    source: valueFromLine(block, '来源') || ''
  };
}

function valueFromLine(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^- ${escaped}：(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

function splitList(value = '') {
  return value.split(/[、,]/).map(item => item.trim()).filter(Boolean);
}

function renderIndex(issues) {
  const latest = issues[0];
  const latestRepos = latest?.repos.slice(0, 8) || [];
  const body = latest
    ? `
      <section class="hero">
        <div>
          <p class="eyebrow">Latest Digest</p>
          <h1>${escapeHtml(title)}</h1>
          <p class="lead">${escapeHtml(description)}</p>
        </div>
        <div class="status">
          <span>${escapeHtml(latest.date)}</span>
          <strong>${escapeHtml(latest.selectedCount)}</strong>
          <span>入选仓库</span>
        </div>
      </section>
      <section class="toolbar">
        <a class="button primary" href="daily/${latest.date}.html">阅读今日日报</a>
        <a class="button" href="feed.xml">订阅 RSS</a>
        <a class="button" href="daily/${latest.date}.md">查看 Markdown 源文件</a>
      </section>
      <section class="grid">${latestRepos.map(renderRepoCard).join('\n')}</section>
      <section class="archive">
        <h2>历史日报</h2>
        ${renderArchive(issues)}
      </section>`
    : `<section class="empty"><h1>${escapeHtml(title)}</h1><p>尚未生成日报。</p></section>`;

  return pageShell({pageTitle: title, body, root: '.'});
}

function renderDaily(issue) {
  const body = `
    <section class="hero compact">
      <div>
        <p class="eyebrow">Daily Digest</p>
        <h1>${escapeHtml(issue.date)} 控制理论趋势日报</h1>
        <p class="lead">候选仓库 ${escapeHtml(issue.candidateCount || '未知')} 个，入选 ${escapeHtml(issue.selectedCount)} 个。</p>
      </div>
      <div class="status">
        <span>RSS / Web</span>
        <strong>${escapeHtml(issue.repos.length)}</strong>
        <span>cards</span>
      </div>
    </section>
    <section class="toolbar">
      <a class="button" href="../index.html">返回首页</a>
      <a class="button" href="../feed.xml">订阅 RSS</a>
      <a class="button" href="${issue.date}.md">查看 Markdown 源文件</a>
    </section>
    <section class="list">${issue.repos.map(renderRepoDetail).join('\n')}</section>`;
  return pageShell({pageTitle: `${issue.date} - ${title}`, body, root: '..'});
}

function renderRepoCard(repo) {
  return `
    <article class="card">
      <div class="card-head">
        <h2><a href="${escapeAttr(repo.url)}">${escapeHtml(repo.name)}</a></h2>
        <span class="priority">${escapeHtml(repo.priority)}</span>
      </div>
      <p>${escapeHtml(repo.summary)}</p>
      <div class="meta">
        <span>${escapeHtml(repo.language)}</span>
        <span>${escapeHtml(repo.stars)} stars</span>
        <span>${escapeHtml(repo.updated)}</span>
      </div>
      <div class="tags">${repo.keywords.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
    </article>`;
}

function renderRepoDetail(repo) {
  return `
    <article class="detail">
      <header>
        <div>
          <h2><a href="${escapeAttr(repo.url)}">${escapeHtml(repo.name)}</a></h2>
          <p class="summary">${escapeHtml(repo.summary)}</p>
        </div>
        <span class="priority">${escapeHtml(repo.priority)}</span>
      </header>
      <dl class="metrics">
        <div><dt>Stars</dt><dd>${escapeHtml(repo.stars)}</dd></div>
        <div><dt>Forks</dt><dd>${escapeHtml(repo.forks)}</dd></div>
        <div><dt>语言</dt><dd>${escapeHtml(repo.language)}</dd></div>
        <div><dt>最近更新</dt><dd>${escapeHtml(repo.updated)}</dd></div>
      </dl>
      <div class="tags">${repo.keywords.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
      <section><h3>对控制理论的意义</h3><p>${escapeHtml(repo.theory)}</p></section>
      <section><h3>可插入的理论点</h3><p>${escapeHtml(repo.insertion)}</p></section>
      <section><h3>Codex 实践判断</h3><p>${escapeHtml(repo.codex)}</p></section>
      <footer>${escapeHtml(repo.source)}</footer>
    </article>`;
}

function renderArchive(issues) {
  return `
    <ol class="archive-list">
      ${issues.map(issue => `
        <li>
          <a href="daily/${issue.date}.html">${escapeHtml(issue.date)}</a>
          <span>${escapeHtml(issue.selectedCount)} 个仓库</span>
        </li>`).join('\n')}
    </ol>`;
}

function pageShell({pageTitle, body, root}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeAttr(description)}">
  <link rel="alternate" type="application/rss+xml" title="${escapeAttr(title)}" href="${root}/feed.xml">
  <link rel="stylesheet" href="${root}/assets/styles.css">
</head>
<body>
  <main class="shell">${body}</main>
</body>
</html>
`;
}

function renderRss(issues) {
  const siteLink = baseUrl || '.';
  const items = issues.slice(0, 30).map(issue => {
    const link = absoluteUrl(`daily/${issue.date}.html`);
    const topRepos = issue.repos.slice(0, 5).map(repo => repo.name).join('、');
    return `
    <item>
      <title>${xml(`${issue.date} 控制理论趋势日报`)}</title>
      <link>${xml(link)}</link>
      <guid>${xml(link)}</guid>
      <pubDate>${new Date(`${issue.date}T00:00:00Z`).toUTCString()}</pubDate>
      <description>${xml(`入选 ${issue.selectedCount} 个仓库：${topRepos}`)}</description>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xml(title)}</title>
    <link>${xml(siteLink)}</link>
    <description>${xml(description)}</description>
    <language>zh-CN</language>
    ${items}
  </channel>
</rss>
`;
}

function renderCss() {
  return `:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --text: #17202a;
  --muted: #5f6b7a;
  --line: #d9dee7;
  --accent: #0f766e;
  --accent-strong: #134e4a;
  --tag: #eef6f5;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif;
  line-height: 1.55;
}
a { color: var(--accent-strong); text-decoration: none; }
a:hover { text-decoration: underline; }
.shell { width: min(1180px, calc(100vw - 32px)); margin: 0 auto; padding: 28px 0 56px; }
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 24px;
  align-items: end;
  padding: 28px 0 18px;
  border-bottom: 1px solid var(--line);
}
.hero.compact { padding-top: 18px; }
.eyebrow { margin: 0 0 6px; color: var(--accent); font-weight: 700; font-size: 13px; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(28px, 4vw, 46px); line-height: 1.12; letter-spacing: 0; }
.lead { max-width: 780px; margin: 14px 0 0; color: var(--muted); font-size: 17px; }
.status { border: 1px solid var(--line); background: var(--panel); padding: 16px; display: grid; gap: 4px; }
.status strong { font-size: 34px; line-height: 1; color: var(--accent-strong); }
.status span { color: var(--muted); }
.toolbar { display: flex; flex-wrap: wrap; gap: 10px; padding: 18px 0; }
.button { border: 1px solid var(--line); background: var(--panel); padding: 9px 13px; font-weight: 650; }
.button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.card, .detail { background: var(--panel); border: 1px solid var(--line); padding: 16px; }
.card-head, .detail header { display: flex; gap: 14px; justify-content: space-between; align-items: flex-start; }
.card h2, .detail h2 { margin: 0; font-size: 18px; line-height: 1.25; overflow-wrap: anywhere; }
.card p, .summary { margin: 12px 0; color: var(--text); }
.priority { flex: 0 0 auto; background: var(--tag); color: var(--accent-strong); padding: 4px 8px; border: 1px solid #c9e7e2; font-size: 12px; font-weight: 700; }
.meta, .tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.meta span, .tags span { color: var(--muted); background: #f1f3f6; padding: 3px 7px; font-size: 13px; }
.tags span { color: var(--accent-strong); background: var(--tag); }
.list { display: grid; gap: 16px; }
.detail section { border-top: 1px solid var(--line); margin-top: 14px; padding-top: 12px; }
.detail h3 { margin: 0 0 6px; font-size: 15px; }
.detail p { margin: 0; color: var(--muted); }
.detail footer { margin-top: 14px; color: var(--muted); font-size: 13px; }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 14px 0; }
.metrics div { background: #f8fafc; border: 1px solid var(--line); padding: 10px; }
.metrics dt { color: var(--muted); font-size: 12px; }
.metrics dd { margin: 2px 0 0; font-weight: 750; overflow-wrap: anywhere; }
.archive { margin-top: 28px; }
.archive h2 { font-size: 20px; }
.archive-list { padding-left: 20px; }
.archive-list li { margin: 8px 0; }
.archive-list span { color: var(--muted); margin-left: 8px; }
.empty { padding: 60px 0; }
@media (max-width: 720px) {
  .shell { width: min(100vw - 20px, 1180px); padding-top: 14px; }
  .hero { grid-template-columns: 1fr; align-items: start; }
  .status { width: 100%; }
  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`;
}

function absoluteUrl(relativePath) {
  if (!baseUrl) return relativePath;
  return `${baseUrl}/${relativePath.replace(/^\/+/, '')}`;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function inferGitHubPagesUrl() {
  const repository = process.env.GITHUB_REPOSITORY || '';
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    return '';
  }
  return repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? `https://${owner}.github.io`
    : `https://${owner}.github.io/${repo}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value = '') {
  return escapeHtml(value);
}

function xml(value = '') {
  return escapeHtml(value);
}
