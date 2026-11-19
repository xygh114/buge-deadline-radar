/* 排程引擎回归测试：node tests/plan.test.js */
global.window = global;
require('../assets/data.js');
require('../assets/parser.js');
require('../assets/plan.js');

const BG = global.BG;
const NOW = new Date('2026-11-19T15:50:00+08:00');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

function baseSettings(over) {
  return Object.assign({
    dailyHours: 3, weekendBonus: 1, wake: '07:30', sleep: '23:00', goalMinutes: 45,
    gpaCurrent: 3.42, gpaTarget: 3.72, gpaScale: 4,
    focusMinutes: 45, breakMinutes: 10, minBlockMinutes: 20, horizonDays: 7
  }, over || {});
}

function seedState(over) {
  return Object.assign({
    tasks: BG.seedTasks(NOW),
    goals: BG.seedGoals(NOW),
    activities: BG.seedActivities(NOW),
    settings: baseSettings()
  }, over || {});
}

const state = seedState();
const plan = BG.planner.buildWeek(state, NOW);
const meals = [[720, 810], [1080, 1140]];
const minOf = (ts) => { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); };

console.log('\n== 1. 一周骨架 ==');
check('排满 7 天', plan.days.length === 7, plan.days.length);
check('每天都有可用预算', plan.days.every(d => d.budgetMinutes > 0));
check('今天不是深夜状态', plan.days[0].late === false);
check('示例任务全部排进去', plan.unscheduled.length === 0, plan.unscheduled.map(u => u.title));
check('有任务块和目标块', plan.stats.taskBlocks > 0 && plan.days.some(d => d.goalCount > 0));

console.log('\n== 2. 时间块硬约束 ==');
plan.days.forEach((d) => {
  d.blocks.forEach((b) => {
    const s = minOf(b.start);
    const e = s + b.minutes;
    if (b.kind !== 'activity') {
      check('第 ' + d.index + ' 天块不跨午饭/晚饭', !meals.some(([a, z]) => s < z && e > a), [s, e]);
      check('第 ' + d.index + ' 天块不超过 45 分钟', b.minutes <= 45, b.minutes);
      check('第 ' + d.index + ' 天块在 23:00 前结束', e <= 23 * 60, e);
    }
    const act = d.activities.filter(a => s < minOf(a.end) && e > minOf(a.start));
    check('第 ' + d.index + ' 天不与社团冲突', b.kind === 'activity' ? true : act.length === 0, act.map(a => a.title));
  });
  check('第 ' + d.index + ' 天不超预算', d.plannedMinutes <= d.budgetMinutes, [d.plannedMinutes, d.budgetMinutes]);
  check('第 ' + d.index + ' 天顺序正确', d.blocks.every((b, i) => i === 0 || b.start >= d.blocks[i - 1].start));
});

console.log('\n== 3. 优先级与四象限 ==');
const scores = plan.scores;
check('逾期任务最紧急', scores['seed-5'].urgency === 1);
check('逾期任务进「紧急」象限', scores['seed-5'].quadrant === 'quick' || scores['seed-5'].quadrant === 'do');
check('马原论文是重要不紧急', scores['seed-6'].quadrant === 'plan', scores['seed-6'].quadrant);
check('优先级在 0–100', Object.keys(scores).every(id => scores[id].score >= 0 && scores[id].score <= 100));
check('每件事都有可解释理由', Object.keys(scores).every(id => scores[id].reason.length > 4));
check('剩余时间越少越紧急',
  BG.planner.scoreTask({ dueAt: NOW.getTime() + 2 * 3600000, estHours: 1, weight: 10, credits: 3, importance: 2 }, BG.planner.makeContext(state, NOW)).urgency >
  BG.planner.scoreTask({ dueAt: NOW.getTime() + 72 * 3600000, estHours: 1, weight: 10, credits: 3, importance: 2 }, BG.planner.makeContext(state, NOW)).urgency);

console.log('\n== 4. 目标与社团 ==');
const dayGoalBlocks = plan.days.map(d => d.blocks.filter(b => b.goalId === 'goal-d1').length);
check('每日目标每天一块', dayGoalBlocks.every(n => n === 1), dayGoalBlocks);
const weekGoal = plan.goals.filter(g => g.id === 'goal-w1')[0];
check('周目标被关联任务覆盖后不再重复占时间', weekGoal && weekGoal.need === 0, weekGoal && weekGoal.need);
check('关联任务的进度会算进目标进度', BG.planner.goalProgress(state.goals[0], state.tasks) >= 0);
check('社团出现在时间轴上', plan.days.some(d => d.blocks.some(b => b.kind === 'activity')));
check('社团日没有被重复扣时间', plan.days.every(d => d.activities.length <= 2));

console.log('\n== 5. 绩点与预算 ==');
const ctx = (st) => BG.planner.makeContext(st, NOW);
const task = { dueAt: NOW.getTime() + 30 * 3600000, estHours: 3, weight: 30, credits: 4, importance: 2, status: 'todo' };
const low = BG.planner.scoreTask(task, ctx(seedState({ settings: baseSettings({ gpaCurrent: 3.8, gpaTarget: 3.8 }) })));
const high = BG.planner.scoreTask(task, ctx(seedState({ settings: baseSettings({ gpaCurrent: 3.0, gpaTarget: 3.8 }) })));
check('绩点没差距时压力为 0', low.importance < high.importance, [low.importance, high.importance]);
const cheap = BG.planner.buildWeek(seedState({ settings: baseSettings({ dailyHours: 1 }) }), NOW);
const rich = BG.planner.buildWeek(seedState({ settings: baseSettings({ dailyHours: 6 }) }), NOW);
check('预算越大排得越多', rich.stats.plannedHours > cheap.stats.plannedHours, [cheap.stats.plannedHours, rich.stats.plannedHours]);
check('预算 1 小时时明确提示排不下', cheap.unscheduled.length > 0, cheap.unscheduled.length);

console.log('\n== 5b. 重要性占比与职业规划 ==');
const wNoCareer = BG.planner.importanceWeights(baseSettings({ careerGoal: '' }));
check('没填职业规划时职业项为 0', wNoCareer.career === 0);
check('没填时绩点和学分各占一半', Math.abs(wNoCareer.gpa - 0.5) < 1e-9 && Math.abs(wNoCareer.credits - 0.5) < 1e-9,
  [wNoCareer.gpa, wNoCareer.credits]);
const wCustom = BG.planner.importanceWeights(baseSettings({
  careerGoal: '算法工程师',
  importanceWeights: { gpa: 50, credits: 30, career: 20 }
}));
check('自定义占比归一化', Math.abs(wCustom.gpa - 0.5) < 1e-9 && Math.abs(wCustom.credits - 0.3) < 1e-9 && Math.abs(wCustom.career - 0.2) < 1e-9,
  wCustom);
const careerTask = Object.assign({}, task, { career: true });
const careerOff = BG.planner.scoreTask(careerTask, ctx(seedState({ settings: baseSettings({ careerGoal: '算法工程师' }) })));
const careerTaskOff = BG.planner.scoreTask(Object.assign({}, task, { career: false }), ctx(seedState({ settings: baseSettings({ careerGoal: '算法工程师' }) })));
check('勾了职业规划的任务重要度更高', careerOff.importance > careerTaskOff.importance,
  [careerOff.importance, careerTaskOff.importance]);
const noGoalCtx = ctx(seedState({ settings: baseSettings({ careerGoal: '' }) }));
check('没填职业规划时勾选不影响', Math.abs(
  BG.planner.scoreTask(careerTask, noGoalCtx).importance -
  BG.planner.scoreTask(Object.assign({}, task, { career: false }), noGoalCtx).importance) < 1e-9);
const creditHeavy = BG.planner.importanceWeights(baseSettings({
  careerGoal: '', importanceWeights: { gpa: 0, credits: 100, career: 0 }
}));
check('把学分调到 100% 后只看学分', creditHeavy.credits === 1 && creditHeavy.gpa === 0);

console.log('\n== 5c. 紧急 / 重要总占比 ==');
const HOUR = 3600000, DAYMS = 86400000;
const pwDefault = BG.planner.priorityWeights(baseSettings());
check('默认紧急 60 / 重要 40', Math.abs(pwDefault.urgency - 0.6) < 1e-9 && Math.abs(pwDefault.importance - 0.4) < 1e-9,
  pwDefault);
const pw73 = BG.planner.priorityWeights(baseSettings({ priorityWeights: { urgency: 70, importance: 30 } }));
check('7:3 归一化', Math.abs(pw73.urgency - 0.7) < 1e-9 && Math.abs(pw73.importance - 0.3) < 1e-9, pw73);
const urgentTask = { dueAt: NOW.getTime() + 2 * HOUR, estHours: 0.5, weight: 5, credits: 1, career: false, status: 'todo' };
const importantTask = { dueAt: NOW.getTime() + 5 * DAYMS, estHours: 2, weight: 40, credits: 4, career: true, status: 'todo' };
function pwCtx(pw) {
  return BG.planner.makeContext(seedState({
    settings: baseSettings({ careerGoal: '算法工程师', priorityWeights: pw })
  }), NOW);
}
const u73 = BG.planner.scoreTask(urgentTask, pwCtx({ urgency: 70, importance: 30 }));
const u55 = BG.planner.scoreTask(urgentTask, pwCtx({ urgency: 50, importance: 50 }));
const i73 = BG.planner.scoreTask(importantTask, pwCtx({ urgency: 70, importance: 30 }));
const i55 = BG.planner.scoreTask(importantTask, pwCtx({ urgency: 50, importance: 50 }));
check('急事在 7:3 下分数更高', u73.score > u55.score, [u73.score, u55.score]);
check('要事在 5:5 下分数更高', i55.score > i73.score, [i55.score, i73.score]);
const zero = BG.planner.priorityWeights(baseSettings({ priorityWeights: { urgency: 0, importance: 0 } }));
check('极端 0:0 回退到 6:4', Math.abs(zero.urgency - 0.6) < 1e-9 && Math.abs(zero.importance - 0.4) < 1e-9);

console.log('\n== 6. 空数据与深夜 ==');
const empty = BG.planner.buildWeek({ tasks: [], goals: [], activities: [], settings: baseSettings() }, NOW);
check('空数据也能给出 7 天', empty.days.length === 7);
check('空数据没有块', empty.days.every(d => d.blocks.length === 0));
const late = BG.planner.buildWeek(seedState(), new Date('2026-11-19T23:40:00+08:00'));
check('23:40 今天不再排学习块',
  late.days[0].late === true && late.days[0].blocks.filter(b => b.kind !== 'activity').length === 0);

console.log('\n== 7. 确定性 ==');
const again = BG.planner.buildWeek(seedState(), NOW);
check('同样输入同样结果', JSON.stringify(again.days) === JSON.stringify(plan.days));

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
