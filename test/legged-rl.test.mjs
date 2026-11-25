import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classifyLegged, collectLegged, GROUPS, pickUpdate, renderLegged} from '../scripts/legged-rl.mjs';

const sha = 'a'.repeat(40);
const sample = {
  full_name:'example/go2-locomotion', description:'Reinforcement learning for Unitree Go2 locomotion',
  topics:[], language:'Python', default_branch:'main', pushed_at:'2026-11-25T12:00:00Z'
};
const quadruped = '# Go2\n\nQuadruped locomotion trained with PPO. Policy actions are joint position targets.\n\nUse MuJoCo to evaluate. No real hardware.\n\n`python scripts/train.py`';
const humanoid = '# G1\n\nHumanoid whole-body motion tracking with reinforcement learning.\n\nTraining: `python scripts/train.py`.';
const rawCommit = {
  html_url:`https://github.com/${sample.full_name}/commit/${sha}`,
  commit:{message:'Train and evaluate',committer:{date:'2026-11-25T12:00:00Z'}},
  files:[{filename:'source/locomotion/controller.py',status:'modified'}]
};

test('requires platform, RL, motion task and implementation evidence', () => {
  assert.deepEqual(classifyLegged(sample, quadruped).groups, [GROUPS[0]]);
  assert.equal(classifyLegged(sample, quadruped).output, '关节位置目标（或增量）');
  assert.match(classifyLegged(sample, quadruped).validation, /未核实实机/);
  assert.deepEqual(classifyLegged({...sample,full_name:'example/g1',description:''}, humanoid).groups,[GROUPS[1]]);
  const controls = [
    ['MPC for legged robots', '# Quadruped locomotion\nTrain classical MPC controller with `python train.py`.'],
    ['Wheeled reinforcement learning', '# TurtleBot\n\nPPO navigation training with `python train.py`.'],
    ['Robot model library', '# Quadruped model collection\n\nSee PPO motion control with `python train.py`.'],
    ['Generic simulator', '# Simulator\n\nUse `python train.py`.\n\n## References\nQuadruped RL training for locomotion.'],
    ['Generic RL', '# PPO\nTrain with `python train.py`.'],
    ['Quadruped reinforcement learning', '# Quadruped gait research\nUses PPO to train walking.']
  ];
  for (const [description,body] of controls)
    assert.equal(classifyLegged({...sample, full_name:'example/negative',description},body),null,description);
});

test('requires a new implementation change, not docs/tests only', () => {
  const doc = {...rawCommit,files:[{filename:'docs/train.py',status:'modified'},{filename:'README.md',status:'modified'},{filename:'tests/test_controller.py',status:'added'}]};
  assert.equal(pickUpdate([doc],new Set()),undefined);
  assert.equal(pickUpdate([rawCommit],new Set([rawCommit.html_url])),undefined);
  assert.equal(pickUpdate([doc,rawCommit],new Set()),rawCommit);
});

test('collects evidence and renders links, and labels incomplete results', async () => {
  const config = {perSearch: 12,maxPerGroup:4,searches:[
    {label:'quads',query:'quad',group:GROUPS[0]}, {label:'humans',query:'humanoid',group:GROUPS[1]},
    {label:'supplement',query:'more',group:GROUPS[1]}
  ]};
  const args = {config,since:'2026-11-18',until:'2026-11-25T18:00:00Z',warn:()=>{},
    fetchText:async()=>quadruped,fetchJson:async url=>{
      if(url.includes('q=quad+')) return {items:[sample]};
      if(url.includes('q=humanoid+')) return {items:[]};
      if(url.includes('q=more+')) return {items:[],incomplete_results:true};
      if(url.includes('/commits?')) return [{sha}];
      if(url.endsWith(sha)) return rawCommit;
      assert.fail(url);
    }};
  const result = await collectLegged(args);
  assert.equal(result.selected.length,1);
  assert.equal(result.errorCount,1);
  const md = renderLegged({date:'2026-11-25',title:'测试日报',timezone:'Asia/Singapore',since:args.since,...result});
  assert.match(md,/组别：四足机器人/);
  assert.match(md,/更新提交：https:\/\/github\.com\//);
  assert.match(md,/结果可能不全/);
  assert.equal((await collectLegged({...args,seen:new Set([rawCommit.html_url])})).selected.length,0);
  await assert.rejects(collectLegged({...args,fetchJson:async()=>{throw Error('503');}}),/Incomplete search coverage/);
});
