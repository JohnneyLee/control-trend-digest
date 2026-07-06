import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'config', 'control-keywords.json');
const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'control-theory-github-trend-digest';
const REQUEST_TIMEOUT_MS = Number(process.env.DIGEST_REQUEST_TIMEOUT_MS || 10000);
const FETCH_RETRIES = Number(process.env.DIGEST_FETCH_RETRIES ?? 2);
const KEYWORD_LABEL_ZH = {
  ROS2: 'ROS2',
  Gazebo: 'Gazebo 仿真',
  robotics: '机器人',
  'trajectory tracking': '轨迹跟踪',
  MPC: '模型预测控制',
  CBF: '控制障碍函数',
  Lyapunov: 'Lyapunov 稳定性',
  optimization: '优化与最优控制',
  'control toolbox': '控制工具箱',
  'autonomous driving': '自动驾驶',
  simulation: '仿真',
  'state estimation': '状态估计',
  observer: '观测器',
  'digital twin': '数字孪生'
};

const args = parseArgs(process.argv.slice(2));
const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
const runDate = args.date || formatDate(new Date(), config.timezone || 'UTC');
const outputDir = args.outputDir || config.outputDir || 'daily';
const outputPath = path.join(ROOT, outputDir, `${runDate}.md`);

const trends = await collectTrendingCandidates(config);
const searchCandidates = await collectSearchSupplement(config, runDate);
const candidates = dedupeByName([...trends, ...searchCandidates]);
const enriched = await enrichAndClassify(candidates, config);
const selected = rankCandidates(enriched)
  .filter(repo => repo.matchedKeywords.length >= (config.minKeywordMatches || 1))
  .slice(0, config.maxItems || 20);

const markdown = renderMarkdown({
  date: runDate,
  timezone: config.timezone || 'UTC',
  selected,
  rawCount: candidates.length,
  route: 'fork/adapt vitalets/github-trending-repos'
});

if (args.dryRun) {
  console.log(markdown);
} else {
  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  await fs.writeFile(outputPath, markdown, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
}

async function collectTrendingCandidates(cfg) {
  const settings = cfg.trending || {};
  const languages = settings.languages?.length ? settings.languages : [''];
  const results = [];

  for (const language of languages) {
    const url = trendingUrl(settings.baseUrl, language, settings.since || 'daily');
    try {
      const html = await fetchText(url);
      const repos = parseTrendingPage(html, language || 'all');
      results.push(...repos);
    } catch (error) {
      console.warn(`Skipping trending source ${url}: ${error.message}`);
    }
  }

  return dedupeByName(results);
}

async function collectSearchSupplement(cfg, dateText) {
  const settings = cfg.searchSupplement || {};
  if (settings.enabled === false || process.env.DIGEST_SEARCH_SUPPLEMENT === 'false') {
    return [];
  }

  const since = shiftDate(dateText, -(settings.lookbackDays || 30));
  const perKeyword = settings.perKeyword || 2;
  const minStars = settings.minStars || 0;
  const repos = [];

  for (const keyword of cfg.keywords || []) {
    const searchTerm = keyword.aliases?.[0] || keyword.label;
    const baseQuery = keyword.searchQuery || `${quoteIfNeeded(searchTerm)} in:name,description`;
    const query = `${baseQuery} pushed:>=${since} stars:>=${minStars}`;
    const url = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${perKeyword}`;

    try {
      const data = await fetchJson(url);
      for (const item of data.items || []) {
        repos.push(repoFromSearch(item, keyword.label));
      }
    } catch (error) {
      console.warn(`Skipping search supplement for ${keyword.label}: ${error.message}`);
    }
  }

  return dedupeByName(repos);
}

async function enrichAndClassify(candidates, cfg) {
  const enriched = [];

  for (const candidate of candidates) {
    const metadata = await safeRepoMetadata(candidate.name);
    if (!metadata && candidate.source?.startsWith('trending:')) {
      continue;
    }
    const merged = mergeRepo(candidate, metadata);
    if (shouldSkipRepo(merged, cfg)) {
      continue;
    }
    const shouldReadProject = cfg.matchReadme ||
      process.env.DIGEST_MATCH_README === 'true' ||
      needsReadmeForSummary(merged);
    const readme = shouldReadProject
      ? await safeReadme(candidate.name, merged.defaultBranch)
      : '';
    const matchedKeywords = matchKeywords(merged, readme, cfg.keywords || []);

    if (matchedKeywords.length === 0) {
      continue;
    }
    if (isWeakTrendingMatch(merged, matchedKeywords)) {
      continue;
    }

    const score = scoreRepo(merged, matchedKeywords);
    enriched.push({
      ...merged,
      matchedKeywords,
      score,
      oneLineSummary: oneLineSummary(merged, readme, matchedKeywords),
      whyItMatters: whyItMatters(matchedKeywords),
      theoryInsertionPoint: theoryInsertionPoint(matchedKeywords),
      codexPractical: codexPractical(merged, matchedKeywords),
      priority: priority(score, matchedKeywords, merged)
    });
  }

  return enriched;
}

async function safeRepoMetadata(fullName) {
  try {
    return await fetchJson(`${GITHUB_API}/repos/${fullName}`);
  } catch (error) {
    console.warn(`Metadata unavailable for ${fullName}: ${error.message}`);
    return null;
  }
}

async function safeReadme(fullName, defaultBranch) {
  if (!defaultBranch) {
    return '';
  }

  const url = `${GITHUB_API}/repos/${fullName}/readme`;
  try {
    const text = await fetchText(url, {
      headers: {
        Accept: 'application/vnd.github.raw'
      }
    });
    return text.slice(0, 60000);
  } catch {
    return '';
  }
}

function parseTrendingPage(html, language) {
  const articleRegex = /<article[\s\S]*?<\/article>/g;
  const articles = html.match(articleRegex) || [];

  return articles.map(article => {
    const nameMatch = article.match(/<h2[\s\S]*?<a[^>]*href="\/([^"]+)"[\s\S]*?<\/a>/);
    if (!nameMatch) {
      return null;
    }

    const name = decodeHtml(nameMatch[1].trim().replace(/\s+/g, ''));
    return {
      name,
      url: `https://github.com/${name}`,
      description: textFromFirst(article, /<p[^>]*>([\s\S]*?)<\/p>/),
      language: textFromFirst(article, /itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/),
      stars: numberFromFirst(article, new RegExp(`href="/${escapeRegExp(name)}/stargazers"[\\s\\S]*?<\\/a>`)),
      forks: numberFromFirst(article, new RegExp(`href="/${escapeRegExp(name)}/forks"[\\s\\S]*?<\\/a>`)),
      starsAdded: numberFromFirst(article, /<span[^>]*class="[^"]*float-sm-right[^"]*"[^>]*>([\s\S]*?)<\/span>/),
      source: `trending:${language}`
    };
  }).filter(Boolean);
}

function mergeRepo(candidate, metadata) {
  if (!metadata) {
    return {
      ...candidate,
      topics: candidate.topics || [],
      recentUpdate: candidate.recentUpdate || '',
      defaultBranch: candidate.defaultBranch || ''
    };
  }

  return {
    ...candidate,
    url: metadata.html_url || candidate.url,
    description: metadata.description || candidate.description || '',
    language: metadata.language || candidate.language || '',
    stars: metadata.stargazers_count ?? candidate.stars ?? 0,
    forks: metadata.forks_count ?? candidate.forks ?? 0,
    topics: metadata.topics || [],
    recentUpdate: metadata.pushed_at || metadata.updated_at || '',
    defaultBranch: metadata.default_branch || ''
  };
}

function matchKeywords(repo, readme, keywordConfig) {
  const coreText = normalize([
    repo.name,
    repo.description,
    repo.language,
    ...(repo.topics || [])
  ].join(' '));
  const haystack = readme ? `${coreText} ${normalize(readme)}` : coreText;

  return keywordConfig
    .map(keyword => {
      const aliases = keyword.aliases || [keyword.label];
      const hits = aliases.filter(alias => containsAlias(haystack, alias));
      return hits.length ? {...keyword, hits} : null;
    })
    .filter(Boolean);
}

function shouldSkipRepo(repo, cfg) {
  if (cfg.requireLanguage !== false && !repo.language) {
    return true;
  }

  const text = `${repo.name} ${repo.description || ''}`.toLowerCase();
  const configuredPatterns = cfg.excludePatterns || [];
  const patterns = [
    ...configuredPatterns,
    'curated list',
    'awesome list',
    'internship',
    'new grad',
    'job',
    'subtitler'
  ];

  return patterns.some(pattern => new RegExp(pattern, 'i').test(text));
}

function isWeakTrendingMatch(repo, keywords) {
  if (!repo.source?.startsWith('trending:')) {
    return false;
  }
  const weakLabels = new Set(['optimization', 'simulation', 'robotics']);
  return keywords.every(item => weakLabels.has(item.label));
}

function scoreRepo(repo, keywords) {
  const keywordScore = keywords.reduce((sum, item) => sum + (item.weight || 1), 0);
  const trendingScore = repo.source?.startsWith('trending:') ? 3 : 1;
  const starsAddedScore = repo.starsAdded ? Math.min(5, Math.ceil(repo.starsAdded / 100)) : 0;
  const popularityScore = Math.min(4, Math.floor(Math.log10((repo.stars || 0) + 1)));
  const recencyScore = isRecentlyUpdated(repo.recentUpdate, 45) ? 2 : 0;
  const referencePenalty = isReferenceRepo(repo) || isDocLanguage(repo.language) ? 4 : 0;
  return keywordScore + trendingScore + starsAddedScore + popularityScore + recencyScore - referencePenalty;
}

function rankCandidates(repos) {
  return repos.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.starsAdded || 0) !== (a.starsAdded || 0)) return (b.starsAdded || 0) - (a.starsAdded || 0);
    return (b.stars || 0) - (a.stars || 0);
  });
}

function priority(score, keywords, repo) {
  const labels = new Set(keywords.map(item => item.label));
  const directTheory = ['MPC', 'CBF', 'Lyapunov', 'trajectory tracking', 'state estimation', 'observer'];
  if (isReferenceRepo(repo) || isDocLanguage(repo.language)) {
    return score >= 9 ? 'medium' : 'low';
  }
  if (score >= 15 || directTheory.some(label => labels.has(label))) return 'high';
  if (score >= 9) return 'medium';
  return 'low';
}

function priorityDisplay(value) {
  const labels = {
    high: '高',
    medium: '中',
    low: '低'
  };
  return `${labels[value] || value} (${value})`;
}

function whyItMatters(keywords) {
  const direct = keywords
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, 3)
    .map(item => `${item.label}：${item.why}`);
  return direct.join('；');
}

function theoryInsertionPoint(keywords) {
  const direct = keywords
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, 2)
    .map(item => item.insertion);
  return direct.join('；');
}

function codexPractical(repo, keywords) {
  const hasCodeSignal = Boolean(repo.language);
  const highValue = keywords.some(item => (item.weight || 0) >= 4);
  if (isReferenceRepo(repo) || isDocLanguage(repo.language)) {
    return '有限可行 - 先把它作为参考资料，抽取一个聚焦的控制器、估计器、仿真器或 benchmark';
  }
  if (hasCodeSignal && highValue) {
    return '可以 - Codex 可将其改造成可运行的控制器、仿真器、估计器或 benchmark wrapper';
  }
  if (hasCodeSignal) {
    return '有限可行 - 加入测试和控制导向场景后，可改造成示例项目';
  }
  return '较低 - 主语言不明确，需要先检查仓库结构';
}

function isReferenceRepo(repo) {
  const text = `${repo.name} ${repo.description || ''}`.toLowerCase();
  return /\b(tutorial|tutorials|notes|notebook|notebooks|course|lecture|curated)\b/.test(text);
}

function isDocLanguage(language = '') {
  return ['tex', 'html', 'css', 'markdown'].includes(language.toLowerCase());
}

function oneLineSummary(repo, readme, keywords) {
  const evidence = summaryEvidence(repo, readme);
  const summary = inferChineseSummary(repo, evidence.text, keywords);
  return evidence.source === 'readme' ? `根据 README 判断，${summary}` : summary;
}

function needsReadmeForSummary(repo) {
  return !isUsefulDescription(repo.description);
}

function summaryEvidence(repo, readme) {
  if (isUsefulDescription(repo.description)) {
    return {
      source: 'description',
      text: repo.description
    };
  }

  const readmeSummary = extractReadmeSummary(readme);
  if (readmeSummary) {
    return {
      source: 'readme',
      text: readmeSummary
    };
  }

  return {
    source: 'fallback',
    text: `${repo.name} ${repo.language || ''}`
  };
}

function isUsefulDescription(description = '') {
  const text = description.replace(/\s+/g, ' ').trim();
  if (text.length < 16) {
    return false;
  }
  return !/(^[-_.]+$|no description|coming soon|todo|test repo|my repo|demo$)/i.test(text);
}

function extractReadmeSummary(readme = '') {
  if (!readme) {
    return '';
  }

  const cleaned = readme
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/---[\s\S]*?---/, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]*\)/g, match => match.replace(/^\[|\]\([^)]*\)$/g, ''))
    .split(/\r?\n/)
    .map(line => line.replace(/^#+\s*/, '').replace(/^[-*+]\s+/, '').trim())
    .filter(line => line.length >= 20)
    .filter(line => !/^(badge|license|install|installation|usage|table of contents|contents)$/i.test(line))
    .filter(line => !/^\|/.test(line));

  const paragraph = cleaned.slice(0, 3).join(' ').replace(/\s+/g, ' ').trim();
  return truncateSentence(paragraph, 260);
}

function inferChineseSummary(repo, evidenceText, keywords) {
  const source = `${repo.name} ${repo.description || ''} ${evidenceText || ''}`;
  const text = source.toLowerCase();
  const type = projectTypeZh(repo, text);
  const focus = keywordFocusZh(keywords);
  const purpose = projectPurposeZh(repo, text, keywords);
  return `这是一个${type}，聚焦${focus}，主要用于${purpose}。`;
}

function projectTypeZh(repo, text) {
  if (/\b(tutorial|tutorials|notes|notebook|notebooks|course|lecture)\b/.test(text)) {
    return '机器人与控制方向的教程/笔记资料';
  }
  if (/diagnostics? gateway|diagnostic|faults|live data|ota/.test(text)) {
    return 'ROS2 机器人诊断与运维工具';
  }
  if (/ros2_control|robotic controllers?|controller collection/.test(text)) {
    return 'ROS2 机器人控制器集合';
  }
  if (/gazebo|gz sim|robotics simulator|robot simulator/.test(text)) {
    return '开源机器人仿真平台';
  }
  if (/carla|autonomous driving|self[- ]driving|adas/.test(text)) {
    return '自动驾驶仿真与研究平台';
  }
  if (/control barrier function|safety constraint|safety filter|safe set/.test(text)) {
    return '安全控制研究原型';
  }
  if (/model predictive control|mpc|predictive control/.test(text)) {
    return '模型预测控制软件包';
  }
  if (/navigation|localization|mapping|slam|path planning/.test(text)) {
    return '移动机器人导航与定位项目';
  }
  if (/toolbox|library|package|framework/.test(text)) {
    return '控制与机器人相关软件库';
  }
  if (/platform/.test(text)) {
    return '控制相关研究平台';
  }
  return repo.language ? `${repo.language} 开源项目` : '开源项目';
}

function projectPurposeZh(repo, text, keywords) {
  const labels = new Set(keywords.map(item => item.label));

  if (/diagnostics? gateway|diagnostic|faults|live data|ota/.test(text)) {
    return '查看机器人运行状态、诊断故障、执行运维脚本并管理现场机器人';
  }
  if (labels.has('CBF') || /control barrier function|safety constraint|safety filter/.test(text)) {
    return '把安全约束或控制障碍函数接入动作层，形成可验证的安全过滤机制';
  }
  if (labels.has('MPC') || /model predictive control|mpc|predictive control/.test(text)) {
    return '构建和求解带约束的模型预测控制问题';
  }
  if (labels.has('state estimation') || /state estimation|slam|localization|vio|lio|kalman/.test(text)) {
    return '完成定位、SLAM、VIO/LIO 或传感器状态估计，并为反馈控制提供状态量';
  }
  if (labels.has('autonomous driving') || /autonomous driving|carla|self[- ]driving|adas/.test(text)) {
    return '开展自动驾驶感知、规划、轨迹跟踪和安全验证实验';
  }
  if (labels.has('Gazebo') || labels.has('simulation') || /gazebo|simulator|simulation/.test(text)) {
    return '搭建仿真场景、运行被控对象，并做闭环控制器验证';
  }
  if (labels.has('ROS2') || /ros ?2|ros2_control/.test(text)) {
    return '把控制器或机器人功能接入 ROS2 通信、参数和部署流程';
  }
  if (labels.has('trajectory tracking') || /trajectory tracking|path tracking|tracking control/.test(text)) {
    return '实现轨迹跟踪实验，评估跟踪误差、扰动响应和闭环性能';
  }
  if (labels.has('optimization') || /optimal control|optimization|optimisation/.test(text)) {
    return '建立最优控制、约束优化或策略求解实验';
  }
  if (/tutorial|notes|course|lecture/.test(text)) {
    return '整理机器人建模、状态估计、仿真和控制实现的学习材料';
  }
  return `支撑${keywordFocusZh(keywords)}相关的实现、实验或二次开发`;
}

function keywordFocusZh(keywords) {
  const labels = keywords.map(item => KEYWORD_LABEL_ZH[item.label] || item.label);
  if (labels.length === 0) {
    return '控制理论相关方向';
  }
  return labels.slice(0, 4).join('、');
}

function truncateSentence(text, maxLength) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) {
    return clean;
  }
  return `${clean.slice(0, maxLength).replace(/\s+\S*$/, '')}...`;
}

function renderMarkdown({date, timezone, selected, rawCount, route}) {
  const lines = [];
  lines.push(`# 控制理论导向 GitHub 趋势日报 - ${date}`);
  lines.push('');
  lines.push(`- 改造路线：${route}`);
  lines.push(`- 时区：${timezone}`);
  lines.push(`- 候选仓库数：${rawCount}`);
  lines.push(`- 入选仓库数：${selected.length}`);
  lines.push('');

  if (selected.length === 0) {
    lines.push('今天没有仓库匹配已配置的控制理论关键词。');
    lines.push('');
    return lines.join('\n');
  }

  selected.forEach((repo, index) => {
    lines.push(`## ${index + 1}. [${repo.name}](${repo.url})`);
    lines.push('');
    lines.push(`- 仓库名称：${repo.name}`);
    lines.push(`- stars/forks/语言/最近更新：${repo.stars || 0} / ${repo.forks || 0} / ${repo.language || '未知'} / ${shortDate(repo.recentUpdate) || '未知'}`);
    lines.push(`- 匹配关键词：${repo.matchedKeywords.map(item => item.label).join('、')}`);
    lines.push(`- 一句话摘要：${repo.oneLineSummary}`);
    lines.push(`- 对控制理论的意义：${repo.whyItMatters}`);
    lines.push(`- 可插入的理论点：${repo.theoryInsertionPoint}`);
    lines.push(`- Codex 是否能转成实践项目：${repo.codexPractical}`);
    lines.push(`- 优先级：${priorityDisplay(repo.priority)}`);
    lines.push(`- 来源：${repo.source}${repo.starsAdded ? `，今日新增 ${repo.starsAdded} stars` : ''}`);
    lines.push('');
  });

  return `${lines.join('\n').trim()}\n`;
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      ...authHeaders(),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
  }

  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
  }

  return response.text();
}

async function fetchWithRetry(url, options = {}, retries = FETCH_RETRIES) {
  const headers = {
    'User-Agent': USER_AGENT,
    ...(options.headers || {})
  };

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {...options, headers, signal: controller.signal});
    } catch (error) {
      if (attempt === retries) throw error;
      await delay(750 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
}

function authHeaders() {
  const token = process.env.GITHUB_TOKEN;
  return token ? {Authorization: `Bearer ${token}`} : {};
}

function trendingUrl(baseUrl, language, since) {
  const suffix = language ? `/${encodeURIComponent(language)}` : '';
  return `${baseUrl}${suffix}?since=${encodeURIComponent(since)}`;
}

function repoFromSearch(item, keywordLabel) {
  return {
    name: item.full_name,
    url: item.html_url,
    description: item.description || '',
    language: item.language || '',
    stars: item.stargazers_count || 0,
    forks: item.forks_count || 0,
    starsAdded: 0,
    topics: item.topics || [],
    recentUpdate: item.pushed_at || item.updated_at || '',
    defaultBranch: item.default_branch || '',
    source: `search:${keywordLabel}`
  };
}

function dedupeByName(repos) {
  const map = new Map();
  for (const repo of repos) {
    if (!repo?.name) continue;
    const key = repo.name.toLowerCase();
    const existing = map.get(key);
    if (!existing || sourceRank(repo.source) > sourceRank(existing.source)) {
      map.set(key, repo);
    }
  }
  return [...map.values()];
}

function sourceRank(source = '') {
  return source.startsWith('trending:') ? 2 : 1;
}

function textFromFirst(html, regex) {
  const match = html.match(regex);
  return match ? cleanHtml(match[1]) : '';
}

function numberFromFirst(html, regex) {
  const match = html.match(regex);
  if (!match) return 0;
  return toNumber(cleanHtml(match[1] || match[0]));
}

function cleanHtml(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function toNumber(value) {
  const match = value.replace(/,/g, '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function normalize(value) {
  return value
    .toLowerCase()
    .replace(/[_./+-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAlias(haystack, alias) {
  const needle = normalize(alias);
  if (!needle) return false;
  if (needle.includes(' ')) {
    return haystack.includes(needle);
  }
  return new RegExp(`(^|\\s)${escapeRegExp(needle)}(\\s|$)`).test(haystack);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRecentlyUpdated(value, days) {
  if (!value) return false;
  const updated = new Date(value).getTime();
  return Number.isFinite(updated) && Date.now() - updated <= days * 24 * 60 * 60 * 1000;
}

function shortDate(value) {
  return value ? value.slice(0, 10) : '';
}

function formatDate(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function quoteIfNeeded(value) {
  return /\s/.test(value) ? `"${value}"` : value;
}

function parseArgs(argv) {
  const parsed = {dryRun: false};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') parsed.dryRun = true;
    if (arg === '--date') parsed.date = argv[index + 1];
    if (arg === '--output-dir') parsed.outputDir = argv[index + 1];
  }
  return parsed;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
