const API = 'https://api.github.com';
export const GROUPS = ['四足机器人', '人形机器人'];
const PLATFORM = [
  /\b(?:quadruped(?:al|s)?|anymal|mini[ -]?cheetah|go[12]|barkour|unitree[ _-]?a1)\b|四足(?:机器人)?/i,
  /\b(?:humanoids?|biped(?:al|s)?|cassie|digit humanoid|unitree[ _-]?(?:g1|h1(?:_2)?|h2)|booster[ _-]?t1|g1[ _-](?:29dof|locomotion))\b|人形机器人|双足机器人/i
];
const MODELS = [
  [/\bgo1\b/i, 'Go1'], [/\bgo2\b/i, 'Go2'], [/\b(?:unitree[ _-]?)?a1 quadruped\b|\bunitree[ _-]?a1\b/i, 'Unitree A1'],
  [/\banymal\b/i, 'ANYmal'], [/\bbarkour\b/i, 'Barkour'],
  [/\b(?:unitree[ _-]?)?g1\b/i, 'G1'], [/\b(?:unitree[ _-]?)?h1(?:_2)?\b/i, 'H1'],
  [/\bunitree[ _-]?h2\b/i, 'H2'], [/\b(?:booster[ _-]?)?t1\b/i, 'T1'], [/\bcassie\b/i, 'Cassie']
];
const RL = /\b(?:reinforcement[ _-]+learning|deep[ _-]?rl|rsl[ _-]?rl|ppo|sac|shac|ahac|short[ -]horizon actor[ -]critic|amp[- ]ppo|rl[ _-]+(?:train(?:ing)?|policy|gym|lab|locomotion|experts?))\b|强化学习/i;
const TASK = /\b(?:locomotion|gaits?|walk(?:ing)?|run(?:ning)?|rough terrain|commanded (?:base )?velocity|fall recovery|get[- ]?up|push recovery|balance control|whole[ _-]body[ _-](?:tracking|control|motion)|motion tracking|velocity[ _-](?:tracking|command|control)|locomotion controllers?)\b|步态|行走|运动跟踪|全身控制|速度跟踪/i;
const RUN = /\b(?:train(?:ing|ed|er)?|inference|deploy(?:ment|ed)?|sim[ _-]?to[ _-]?real|sim2real|sim2sim|checkpoints?|pretrained|play\.py|train\.py|evaluate\.py)\b|训练|部署|预训练/i;
const ENTRY = /\b(?:python(?:3)?\s+[^\n]{0,150}(?:train|play|eval|deploy|infer)|(?:bash\s+|\.\/)[^\s]{0,100}(?:train|eval|deploy|gym|lab)[^\s]*|uv run [^\n]{0,150}(?:train|eval|deploy)|(?:train|play|evaluate|deploy|inference)\.(?:py|sh)|(?:pre[- ]?trained|policy)\s+(?:weights|checkpoints?)|scripts?\/(?:[^\s/`]{1,50}\/){0,3}(?:train|deploy|eval|infer)[^\s`]{0,50})\b/i;
const EXCLUDE = /(?:^|\/)(?:awesome|paper[-_]?list|arxiv|reading[-_]?list|tutorials?)(?:[-_]|$)|\b(?:curated list|collection of papers|list of papers|paper list|news aggregator|model library|collection of .* models)\b/i;
const WRONG = /\b(?:wheeled robot|differential[ -]drive|mecanum|turtlebot|quadrotor|quadcopter|autonomous driving|humanoid[-_ ]?robot[-_ ]?teleop|navigation-only)\b/i;
const DEPLOY = /\b(?:sim[ _-]?to[ _-]?real|sim2real|(?:real|physical)[ -]robot|real hardware|hardware deployment)\b|实机|真机/i;
const SIM = /\b(?:sim2sim|sim[ _-]?to[ _-]?sim|mujoco|gazebo|isaac[ _-](?:sim|gym|lab)|genesis|pybullet|simulation)\b|仿真/i;
const OUTPUT = [
  [/\b(?:joint position(?: targets?| offsets?| deltas?)?|target joint positions?|joint angles?|position targets?)\b|关节位置/i, '关节位置目标（或增量）'],
  [/\b(?:joint torques?|torque commands?|torque targets?)\b|关节力矩/i, '关节力矩'],
  [/\b(?:footstep targets?|foot placement|foot targets?)\b|落足点/i, '落足点']
];
const FOCUS = [
  [/\b(?:latency|action delay|obs(?:ervation)? delay|sensor delay)\b|延迟/i, '延迟'],
  [/\b(?:push recovery|perturbation|robustness|disturbance)\b|扰动/i, '抗扰'],
  [/\b(?:rough terrain|challenging terrain|staircases?|uneven terrain)\b|复杂地形/i, '复杂地形'],
  [/\b(?:whole[ _-]body[ _-](?:tracking|control)|motion tracking)\b|全身动作跟踪/i, '全身动作跟踪'],
  [/\b(?:velocity[ _-](?:tracking|command|control)|commanded velocity)\b|速度跟踪/i, '速度跟踪']
];
const UPDATE_FILE = /\.(?:py|cpp|cc|hpp|rs|cu|onnx|pt|pth|ckpt|ya?ml|toml|urdf|xml|sh)$/i;
const DOC_ONLY = /(?:^|\/)(?:docs?|tests?|assets?|media|\.github|vendor|third_party)(?:\/|$)|(?:^|\/)(?:test_[^/]+|setup\.py|pyproject\.toml|requirements[^/]*)$/i;
const RELATED_FILE = /locomot|humanoid|quadruped|go[12][_/.-]|g1[_/.-]|train|deploy|inferen|eval|envs?|policy|controller|control|config|reward|actuat|checkpoint|models?\//i;

function sourceText(readme) {
  return readme.slice(0, 60000)
    .replace(/\*\*/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^\n)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g, '$1')
    .replace(/<https?:\/\/[^>]+>|https?:\/\/[^\s)>]+/g, '')
    .split(/^#{1,6}\s+(?:references|related work|citation|bibliography|acknowledg(?:e)?ments)\b/im)[0];
}

export function classifyLegged(repo, readme) {
  const project = String(repo.full_name || '').split('/').at(-1);
  const identity = [project, repo.description || '', ...(repo.topics || [])].join(' ');
  if (!repo.language || repo.archived || repo.disabled || EXCLUDE.test(identity)) return null;
  const cleaned = sourceText(readme);
  const body = cleaned.split('\n')
    .filter(line => !/\bnot (?:a|an)\b[^\n]*\b(?:quadruped|humanoid|biped|sim-to-real)\b/i.test(line))
    .join('\n');
  if (!ENTRY.test(body)) return null;
  const chunks = body.split(/\n\s*\n|(?=^#{1,6}\s)/m).filter(x => x.trim());
  const title = (body.match(/^#\s+(.+)$/m) || [])[1] || '';
  const core = `${identity} ${title}`;
  const intro = chunks.slice(0, 10).join('\n').slice(0, 2200);
  const primary = `${core}\n${intro}`;
  const hasImplementation = windowsHaveImplementation(primary, chunks);
  if (WRONG.test(core) && !PLATFORM.some(p => p.test(core))) return null;
  const windows = chunks.map((_, i) => chunks.slice(i, i + 3).join('\n').slice(0, 2000));
  const groups = GROUPS.filter((_, i) => windows.some(w => {
    // A platform and a motion task must be tied to an RL implementation,
    // not merely scattered across an unrelated README bibliography.
    const p = PLATFORM[i];
    return (p.test(w) && TASK.test(w) && RL.test(`${core}\n${w}`) && RUN.test(w)) ||
      (p.test(primary) && RL.test(primary) && (TASK.test(w) || TASK.test(primary)) && RUN.test(w) && hasImplementation);
  }));
  if (!groups.length) return null;
  const evidence = `${core}\n${body}`;
  const primaryOnly = evidence.match(/\b(go[12]|g1|h1|anymal) is the only (?:fully )?(?:working|supported) robot\b/i)?.[1];
  const modelNames = MODELS.filter(([re]) => re.test(evidence)).map(([, name]) => name);
  const actionContext = body.split('\n').filter(line => /policy.{0,40}output|actions?|commands?|actuators?/i.test(line)).join('\n');
  const excludesHardware = /(?:no (?:physical|real) (?:hardware|robot)|(?:physical|real)[ -]robot[^.\n]{0,50}(?:out of (?:scope|this version)|not (?:tested|included))|\bnot (?:a|an) sim[ -]to[ -]real\b|仅仿真)/i.test(cleaned);
  return {
    groups,
    models: primaryOnly ? modelNames.filter(name => name.toLowerCase() === primaryOnly.toLowerCase()) : modelNames,
    output: OUTPUT.find(([p]) => p.test(actionContext))?.[1] || '文档未明确识别',
    topics: FOCUS.filter(([p]) => p.test(evidence)).map(([, name]) => name),
    validation: groups.length > 1 ? '跨平台：请按机器人和任务分别核对仿真／实机；未统一判定' :
      !excludesHardware && DEPLOY.test(body) ? '文档提及实机或仿真到实机；不等同于已验证实机结果' :
      SIM.test(body) ? '文档有仿真入口或说明；未核实实机' : '验证阶段未明确识别'
  };
}

function windowsHaveImplementation(primary, chunks) {
  return ENTRY.test(primary) || chunks.some(x => ENTRY.test(x) && RUN.test(x));
}

export function pickUpdate(commits, seen) {
  const highLevel = /(?:^|[\/_-])(?:nav2|navigation|waypoints?|racers?|racing)(?:[\/_\.-]|$)/i;
  return commits.find(c => !seen.has(c.html_url) && c.files?.some(f =>
    UPDATE_FILE.test(f.filename) && RELATED_FILE.test(f.filename) && !DOC_ONLY.test(f.filename) && !highLevel.test(f.filename) &&
    ['added', 'modified', 'renamed'].includes(f.status)));
}

export async function collectLegged({config, since, until, fetchJson, fetchText, seen = new Set(), warn = console.warn}) {
  const candidates = new Map();
  const errors = [];
  const complete = new Set();
  function failed(where, error) {
    errors.push(where);
    warn(`Legged RL: ${where}: ${error.message}`);
  }
  function remember(repo, route) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo?.full_name || '')) return;
    const key = repo.full_name.toLowerCase();
    if (!candidates.has(key)) candidates.set(key, {...repo, route});
  }
  for (const search of config.searches) {
    try {
      const q = `${search.query} in:name,description,readme pushed:>=${since} archived:false fork:false`;
      const data = await fetchJson(`${API}/search/repositories?${new URLSearchParams({q, sort:'updated', order:'desc', per_page:String(config.perSearch)})}`);
      if (!Array.isArray(data.items)) throw Error('invalid search results');
      for (const item of data.items) remember(item, search.label);
      if (data.incomplete_results) failed(search.label, Error('incomplete search results'));
      else complete.add(search.group);
    } catch (e) { failed(search.label, e); }
  }
  if (!GROUPS.every(group => complete.has(group))) throw Error('Incomplete search coverage; refusing to publish a misleading digest');
  for (const repo of config.watchlist || []) {
    try { remember(await fetchJson(`${API}/repos/${repo}`), '重点跟踪'); }
    catch (e) { failed(repo, e); }
  }

  const selected = [];
  for (const repo of candidates.values()) {
    if (!repo.language || repo.archived || repo.disabled || EXCLUDE.test(`${repo.full_name} ${repo.description}`) ||
        (repo.pushed_at || '').slice(0,10) < since || !repo.default_branch) continue;
    const base = `${API}/repos/${repo.full_name}`;
    try {
      let readme;
      try { readme = await fetchText(`${base}/readme`, {headers:{Accept:'application/vnd.github.raw+json'}}); }
      catch(e) { if (/^404\b/.test(e.message)) continue; throw e; }
      const fit = classifyLegged(repo, readme);
      if (!fit) continue;
      const list = await fetchJson(`${base}/commits?${new URLSearchParams({
        sha: repo.default_branch, since: `${since}T00:00:00Z`, until, per_page:'7'
      })}`);
      if (!Array.isArray(list)) throw Error('invalid commit results');
      // Do not re-report old changes behind a change already in an earlier issue.
      for (const head of list) {
        const url = `https://github.com/${repo.full_name}/commit/${head.sha}`;
        if (seen.has(url)) break;
        if (!/^[a-f\d]{40}$/i.test(head.sha || '')) continue;
        const commit = await fetchJson(`${base}/commits/${head.sha}`);
        const update = pickUpdate([{...commit, html_url:url}], seen);
        if (!update) continue;
        selected.push({...repo, ...fit, update});
        break;
      }
    } catch(e) { failed(repo.full_name, e); }
  }

  selected.sort((a,b) => b.topics.length - a.topics.length ||
    (b.update.commit?.committer?.date || '').localeCompare(a.update.commit?.committer?.date || '') ||
    a.full_name.localeCompare(b.full_name));
  const final = [];
  const counts = new Map(GROUPS.map(g => [g, 0]));
  for (const repo of selected) {
    if (repo.groups.some(g => counts.get(g) >= config.maxPerGroup)) continue;
    final.push(repo);
    for (const group of repo.groups) counts.set(group, counts.get(group) + 1);
  }
  return {selected:final, rawCount:candidates.size, errorCount:errors.length};
}

function plain(s = '', len = 120) {
  return String(s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, len);
}

export function renderLegged({title, date, timezone, since, selected, rawCount, errorCount}) {
  const lines = [`# ${title} - ${date}`, '', '- 主题：四足机器人、人形机器人', `- 时区：${timezone}`,
    `- 更新窗口（UTC）：${since} 起`, `- 候选仓库数：${rawCount}`, `- 入选仓库数：${selected.length}`];
  if (errorCount) lines.push(`- 数据说明：有 ${errorCount} 个数据源或项目检查未完成，结果可能不全。`);
  else lines.push('- 数据说明：仅汇报检索范围内可核对的相关更新；项目实验未重跑。');
  let index = 0;
  // Cross-platform projects appear once in Markdown, in both relevant web sections.
  for (const [group, repos] of [
    ...GROUPS.map(g => [g, selected.filter(r => r.groups.length === 1 && r.groups.includes(g))]),
    ['四足与人形通用', selected.filter(r => r.groups.length === 2)]
  ]) {
    if (group === '四足与人形通用' && !repos.length) continue;
    lines.push('', `## ${group}`);
    if (!repos.length) lines.push('', '未筛到符合条件的独立条目。');
    for (const r of repos) {
      const name = r.full_name;
      const changeDay = r.update.commit?.committer?.date?.slice(0,10) || '未知';
      lines.push('', `## ${++index}. [${name}](https://github.com/${name})`, '',
        `- 仓库名称：${name}`,
        `- stars/forks/语言/最近更新：${r.stargazers_count || 0} / ${r.forks_count || 0} / ${plain(r.language)} / ${changeDay}`,
        `- 组别：${r.groups.join('、')}`,
        `- 匹配关键词：强化学习运动控制${r.topics.length ? '、'+r.topics.join('、') : ''}`,
        `- 一句话摘要：${r.groups.join('／')}的强化学习运动控制项目${r.topics.length ? '，涉及'+r.topics.join('、') : ''}。`,
        `- 机器人型号：${r.models.join('、') || '文档未明确识别'}`,
        `- 策略输出：${r.output}`,
        `- 复现入口：https://github.com/${name}#readme`,
        `- 验证阶段：${r.validation}`,
        `- 更新提交：${r.update.html_url}`,
        `- 提交说明：${plain(r.update.commit?.message)}`,
        `- 来源：${r.route}`);
    }
  }
  return lines.join('\n') + '\n';
}
