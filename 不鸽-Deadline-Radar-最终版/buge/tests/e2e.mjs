/* 端到端冒烟测试：用 Chrome DevTools Protocol 驱动真实的 Edge。
   运行：node tests/e2e.mjs
   覆盖：首屏渲染 → 导入弹层 → 粘贴示例 → 解析 → 导入 → 勾选完成 → 刷新持久化 → 计划/负荷/ICS */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGE = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const PORT = 9330 + Math.floor(Math.random() * 300);
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'buge-e2e-'));

let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-features=Translate', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`, PAGE
], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((x) => x.type === 'page' && x.url.startsWith('file:'));
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (e) { /* 浏览器还没起来 */ }
    await sleep(250);
  }
  throw new Error('连不上无头浏览器');
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function js(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    throw new Error('页面脚本报错: ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function waitFor(expression, label, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await js(expression)) return true;
    await sleep(120);
  }
  throw new Error('等待超时：' + label);
}

try {
  console.log('\n== A. 首屏 ==');
  await waitFor('!!document.querySelector("#taskList .task")', '任务卡渲染');
  const initial = await js('BG.store.get().tasks.length');
  t('示例任务 8 条', initial === 8, initial);
  t('雷达 7 格', (await js('document.querySelectorAll(".day").length')) === 7);
  t('优先级已排序，首条是逾期任务',
    (await js('document.querySelector("#taskList .task").dataset.bucket')) === 'overdue');
  const planReady = await js('document.querySelectorAll(".plan-item").length >= 1 || document.querySelector("#plan").textContent.indexOf("23:00") !== -1');
  t('今日计划已生成（或已过学习时间）', planReady);
  t('右栏可切换未来 7 天', (await js('document.querySelectorAll(".rday").length')) === 7);
  t('计划页已渲染 7 天', (await js('document.querySelectorAll(".pday").length')) === 7);
  t('本周负荷有数值', /\d/.test(await js('document.querySelector("#loadRatio").textContent')));
  t('侧栏平台计数可见', (await js('document.querySelectorAll(".pf-item").length')) >= 4);

  console.log('\n== B. 导入闭环 ==');
  await js('document.querySelector(".head-actions [data-action=open-import]").click()');
  await waitFor('!!document.querySelector("#noticeInput")', '导入弹层打开');
  t('弹层标题正确', (await js('document.querySelector("#modalTitle").textContent')).includes('把通知粘进来'));

  await js('document.querySelector("[data-action=fill-sample]").click()');
  await waitFor('document.querySelectorAll(".draft").length === 3', '识别出 3 条');
  t('识别出 3 条草稿', (await js('document.querySelectorAll(".draft").length')) === 3);
  t('第 1 条课程识别正确',
    (await js('document.querySelectorAll(".draft-course")[0].value')) === '高等数学A(上)');
  t('第 2 条截止时间识别正确',
    (await js('document.querySelectorAll(".draft")[1].querySelector("[data-field=dueAt]").value')) === '2026-11-25T18:00');
  t('导入按钮显示条数', (await js('document.querySelector("#importBtn").textContent')).includes('3'));

  const before = await js('BG.store.get().tasks.length');
  const expected = await js(`(() => {
    const res = BG.parseNotices(BG.SAMPLE_NOTICE, { now: Date.now(), semStart: BG.store.get().settings.semesterStart });
    const tasks = BG.store.get().tasks;
    let add = 0, skip = 0;
    res.drafts.forEach(d => {
      const dup = tasks.some(t => t.course === d.course && t.title === d.title && Math.abs(t.dueAt - d.dueAt) < 3600000);
      if (dup) skip++; else add++;
    });
    return { add, skip };
  })()`);
  await js('document.querySelector("#importBtn").click()');
  await waitFor('!document.querySelector("#noticeInput")', '弹层关闭');
  await sleep(200);
  const after = await js('BG.store.get().tasks.length');
  t('导入后按去重结果新增', after === before + expected.add, { before, after, expected });
  t('三段通知都识别成草稿', expected.add + expected.skip === 3, expected);
  t('导入后首屏刷新', (await js('document.querySelectorAll("#taskList .task:not(.is-activity)").length')) === after);

  /* 同一段通知再导入一次：应全部判重，不入库 */
  await js('document.querySelector(".head-actions [data-action=open-import]").click()');
  await waitFor('!!document.querySelector("#noticeInput")', '再次打开导入弹层');
  await js('document.querySelector("[data-action=fill-sample]").click()');
  await waitFor('document.querySelectorAll(".draft").length === 3', '再次识别出 3 条');
  await js('document.querySelector("#importBtn").click()');
  await waitFor('!document.querySelector("#noticeInput")', '再次关闭弹层');
  await sleep(200);
  const after2 = await js('BG.store.get().tasks.length');
  t('重复通知不会重复入库（去重生效）', after2 === after, { after, after2 });

  console.log('\n== C. 交互 ==');
  const firstId = await js('document.querySelector("#taskList .task").dataset.id');
  await js(`document.querySelector('.task[data-id="${firstId}"] .check').click()`);
  await sleep(200);
  t('勾选后状态为 done', (await js(`BG.store.get().tasks.find(t=>t.id==="${firstId}").status`)) === 'done');
  t('勾选后从待办分组消失', (await js(`!document.querySelector('.task[data-id="${firstId}"][data-bucket="overdue"]')`)) === true);

  await js(`document.querySelector('.task[data-id="${firstId}"] [data-action=edit]').click()`);
  await sleep(250);
  const editOpen = await js('!!document.querySelector("#fTitle")');
  t('编辑表单可打开', editOpen === true);
  t('编辑表单支持职业规划与学分',
    editOpen === true && (await js('!!document.querySelector("#fCareer")')) === true &&
    (await js('!!document.querySelector("#fCredits")')) === true);
  t('编辑表单可关联目标', editOpen === true && (await js('document.querySelectorAll("#fGoal option").length')) >= 4);
  if (editOpen) {
    await js('document.querySelector("[data-action=close-modal]").click()');
  }

  console.log('\n== D. 刷新持久化 ==');
  await send('Page.reload', { ignoreCache: true });
  await sleep(1200);
  await waitFor('!!document.querySelector("#taskList .task")', '刷新后渲染');
  t('刷新后任务数不变', (await js('BG.store.get().tasks.length')) === after2);
  t('刷新后完成状态保留', (await js(`BG.store.get().tasks.find(t=>t.id==="${firstId}").status`)) === 'done');

  console.log('\n== E. 设置与导出 ==');
  await js('document.querySelector("[data-action=view][data-view=settings]").click()');
  await waitFor('!!document.querySelector("#dailyHours")', '设置页');
  await js('const r=document.querySelector("#dailyHours"); r.value="5"; r.dispatchEvent(new Event("change",{bubbles:true}))');
  await sleep(250);
  t('每日预算改为 5 小时', (await js('BG.store.get().settings.dailyHours')) === 5);
  t('设置页公式说明存在', (await js('document.querySelector(".formula-main").textContent')).includes('60%'));
  t('目标时间滑杆带解释',
    (await js('!!document.querySelector(".setting-explain")')) === true &&
    (await js('document.querySelector(".setting-explain").textContent')).includes('保护时间'));

  t('紧急/重要占比卡存在',
    (await js('!!document.querySelector("#wUrgency") && !!document.querySelector("#wImportance")')) === true);
  t('初始占比 60:40',
    (await js('document.querySelector("#wUrgencyOut").textContent')) === '60%' &&
    (await js('document.querySelector("#wImportanceOut").textContent')) === '40%');
  t('占比说明覆盖 6:4 / 7:3 / 5:5',
    (await js('document.querySelector("#priorityPanel .priority-note").textContent')).includes('6:4') &&
    (await js('document.querySelector("#priorityPanel .priority-note").textContent')).includes('7:3') &&
    (await js('document.querySelector("#priorityPanel .priority-note").textContent')).includes('5:5'));
  await js('var pu=document.querySelector("#wUrgency"); pu.value="70"; pu.dispatchEvent(new Event("change",{bubbles:true}))');
  await sleep(300);
  t('滑杆可调到 7:3',
    (await js('BG.store.get().settings.priorityWeights.urgency')) === 70 &&
    (await js('BG.store.get().settings.priorityWeights.importance')) === 30 &&
    (await js('document.querySelector("#wImportanceOut").textContent')) === '30%');
  await js('var pi=document.querySelector("#wImportance"); pi.value="50"; pi.dispatchEvent(new Event("change",{bubbles:true}))');
  await sleep(300);
  t('滑杆可调到 5:5',
    (await js('BG.store.get().settings.priorityWeights.urgency')) === 50 &&
    (await js('BG.store.get().settings.priorityWeights.importance')) === 50);
  await js('var pr=document.querySelector("#wUrgency"); pr.value="60"; pr.dispatchEvent(new Event("change",{bubbles:true}))');
  await sleep(250);

  const ics = await js('BG.model.toIcs(BG.store.get().tasks)');
  t('ICS 有日历头', ics.startsWith('BEGIN:VCALENDAR'));
  t('ICS 事件数 = 未完成任务数', (ics.match(/BEGIN:VEVENT/g) || []).length === (await js('BG.store.get().tasks.filter(t=>t.status!=="done").length')));
  t('ICS 带 VALARM 提醒', ics.includes('TRIGGER:-PT6H'));

  const total = await js('BG.store.get().tasks.length');
  const done = await js('BG.store.get().tasks.filter(t=>t.status==="done").length');
  t('数据统计自洽', total === after2 && done === 2, { total, done });

  console.log('\n== G. 学习计划（修改版） ==');
  await js('document.querySelector("[data-action=view][data-view=plan]").click()');
  await waitFor('!!document.querySelector(".pdetail-title")', '学习计划页渲染');
  t('计划页显示 7 天', (await js('document.querySelectorAll(".pday").length')) === 7);
  t('计划页展示周/月/日目标', (await js('document.querySelectorAll("#planGoals .pgoal").length')) >= 3);
  const dayTitle0 = await js('document.querySelector(".pdetail-title").textContent');
  await js('document.querySelectorAll(".pday")[1].click()');
  await sleep(200);
  const dayTitle1 = await js('document.querySelector(".pdetail-title").textContent');
  t('可以按天查看计划', dayTitle0 !== dayTitle1, { dayTitle0, dayTitle1 });
  t('计划块带时间与时长', (await js('document.querySelectorAll(".plan-timeline .pblock").length')) >= 1);
  t('计划有时间轴/提示说明', (await js('document.querySelector("#planDetail .plan-note") ? true : false')) === true);

  const planBlocks = await js(`(() => {
    const plan = BG.model.weekPlan(Date.now());
    return plan.days.reduce((n, d) => n + d.blocks.filter(b => b.kind !== 'activity').length, 0);
  })()`);
  t('一周排出了学习块', planBlocks >= 5, planBlocks);
  const clash = await js(`(() => {
    const plan = BG.model.weekPlan(Date.now());
    return plan.days.some(d => d.blocks.some(b => b.kind !== 'activity' &&
      d.activities.some(a => b.start < a.end && b.end > a.start)));
  })()`);
  t('学习块不与社团冲突', clash === false);

  await js('document.querySelector("[data-action=view][data-view=settings]").click()');
  await waitFor('!!document.querySelector("#goalList")', '设置页目标区');
  t('示例周/月/日目标可见', (await js('document.querySelectorAll("#goalList .goal-item").length')) >= 3);
  t('示例社团安排可见', (await js('document.querySelectorAll("#activityList .act-item").length')) >= 3);
  t('绩点输入可见', (await js('!!document.querySelector("#gpaCurrent") && !!document.querySelector("#gpaTarget")')) === true);
  t('每日目标保护时长可调', (await js('!!document.querySelector("#goalMinutes")')) === true);

  const goalsBefore = await js('BG.store.get().goals.length');
  await js('document.querySelector("#goalTitle").value="本周背完 300 个单词"');
  await js('document.querySelector("#goalScope").value="week"');
  await js('document.querySelector("[data-action=add-goal]").click()');
  await sleep(250);
  t('可以新增周目标', (await js('BG.store.get().goals.length')) === goalsBefore + 1);

  const actsBefore = await js('BG.store.get().activities.length');
  await js('document.querySelector("[data-action=open-activity]").click()');
  await waitFor('!!document.querySelector("#fActTitle")', '固定安排弹层');
  t('固定安排支持多种重复方式', (await js('document.querySelectorAll("#fActRepeat option").length')) === 3);
  await js('document.querySelector("#fActTitle").value="吉他社排练"');
  await js('document.querySelector("#fActDay").value="3"');
  await js('document.querySelector("#fActWeeks").value="8"');
  await js('document.querySelector("[data-action=save-activity]").click()');
  await sleep(300);
  t('可以新增社团安排', (await js('BG.store.get().activities.length')) === actsBefore + 1);
  t('可以设置持续周数', (await js('BG.store.get().activities.find(a=>a.title==="吉他社排练").weeks')) === 8);

  console.log('\n== H. 三版新增：职业规划 / 占比 / 档案导入 / 活动周期 ==');
  const otherBefore = await js('BG.store.get().activities.filter(a=>a.kind==="other").length');
  await js('document.querySelector("[data-action=open-activity]").click()');
  await waitFor('!!document.querySelector("#fActTitle")', '再次打开固定安排弹层');
  t('活动类型有社团和其他', (await js('document.querySelectorAll("#fActKind option").length')) === 2);
  await js('document.querySelector("#fActTitle").value="社区志愿服务"');
  await js('document.querySelector("#fActKind").value="other"');
  await js('document.querySelector("#fActRepeat").value="week"');
  await js('document.querySelector("#fActRepeat").dispatchEvent(new Event("change",{bubbles:true}))');
  await js('document.querySelector("#fActDay").value="5"');
  await js('document.querySelector("[data-action=save-activity]").click()');
  await sleep(300);
  t('可以新增其他活动（讲座/实践）',
    (await js('BG.store.get().activities.filter(a=>a.kind==="other").length')) === otherBefore + 1);
  t('可以设为仅本周',
    (await js('BG.store.get().activities.find(a=>a.title==="社区志愿服务").weeks')) === 1);

  await js('document.querySelector("[data-action=open-activity]").click()');
  await waitFor('!!document.querySelector("#fActTitle")', '编辑前打开弹层');
  await js('document.querySelector("#fActTitle").value="临时讲座"');
  await js('document.querySelector("#fActRepeat").value="once"');
  await js('document.querySelector("#fActRepeat").dispatchEvent(new Event("change",{bubbles:true}))');
  await js('document.querySelector("#fActDate").value="2026-11-21"');
  await js('document.querySelector("[data-action=save-activity]").click()');
  await sleep(300);
  t('可以新增单次活动',
    (await js('BG.store.get().activities.find(a=>a.title==="临时讲座").repeat')) === 'once');

  const editActId = await js('BG.store.get().activities.find(a=>a.title==="吉他社排练").id');
  await js(`document.querySelector('[data-action=edit-activity][data-id="${editActId}"]').click()`);
  await waitFor('!!document.querySelector("#fActTitle")', '编辑固定安排');
  await js('document.querySelector("#fActWeeks").value="4"');
  await js('document.querySelector("[data-action=save-activity]").click()');
  await sleep(300);
  t('可以修改已有活动持续周数',
    (await js('BG.store.get().activities.find(a=>a.title==="吉他社排练").weeks')) === 4);

  t('重要性三个滑杆都在', (await js('!!document.querySelector("#wGpa") && !!document.querySelector("#wCredits") && !!document.querySelector("#wCareer")')) === true);
  t('职业规划卡有输入框', (await js('!!document.querySelector("#careerGoal")')) === true);
  t('档案导入入口存在', (await js('!!document.querySelector("#profileFile")')) === true);
  const weights0 = await js('BG.store.get().settings.importanceWeights');
  await js('var el=document.querySelector("#wGpa"); el.value="50"; el.dispatchEvent(new Event("change",{bubbles:true}))');
  await sleep(300);
  const weights1 = await js('BG.store.get().settings.importanceWeights');
  t('调高一项后三项仍合计 100', Math.abs(weights1.gpa + weights1.credits + weights1.career - 100) < 0.2,
    { weights0, weights1 });
  t('调高绩点后另外两项按比例减少', weights1.gpa === 50 && weights1.credits < weights0.credits, weights1);

  await js('var careerEl=document.querySelector("#careerGoal"); careerEl.value="成为数据分析师"; careerEl.dispatchEvent(new Event("change",{bubbles:true}))');
  await sleep(250);
  t('可以录入职业规划', (await js('BG.store.get().settings.careerGoal')) === '成为数据分析师');
  t('录入后职业滑杆可用', (await js('!document.querySelector("#wCareer").disabled')) === true);

  await js(`(() => {
    const input = document.querySelector('#profileFile');
    const dt = new DataTransfer();
    dt.items.add(new File(['gpaCurrent=3.6\\ncreditsEarned=120\\ncreditsRequired=160\\nschoolRequirement=毕业需160学分'], 'profile.txt', {type:'text/plain'}));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await sleep(600);
  t('可以导入学校绩点学分文件',
    (await js('BG.store.get().settings.gpaCurrent')) === 3.6 &&
    (await js('BG.store.get().settings.creditsEarned')) === 120, await js('BG.store.get().settings'));

  await js('document.querySelector("[data-action=view][data-view=overview]").click()');
  await waitFor('!!document.querySelector(".group-act")', '固定安排分组');
  const shownActs = await js('document.querySelectorAll("#taskList .group-act .task.is-activity").length');
  const storedActs = await js('BG.store.get().activities.length');
  t('任务清单显示固定安排', shownActs === storedActs, { shownActs, storedActs });
  t('固定安排区分社团与其他',
    (await js('document.querySelectorAll(".group-act .task.is-activity[data-kind=other]").length')) >= 2);

  await js('document.querySelector("[data-action=view][data-view=plan]").click()');
  await waitFor('!!document.querySelector(".back-btn")', '计划页返回键');
  t('学习计划左上角有返回键', (await js('!!document.querySelector(".back-btn")')) === true);
  await js('document.querySelector(".back-btn").click()');
  await sleep(250);
  t('返回键回到上一步',
    (await js('!document.querySelector("#view-overview").classList.contains("is-hidden")')) === true &&
    (await js('document.querySelector("#view-plan").classList.contains("is-hidden")')) === true);

  await js('document.querySelector("[data-action=open-music]").click()');
  await waitFor('!!document.querySelector("#musicList")', '音乐弹层');
  t('音乐有多首内置白噪', (await js('document.querySelectorAll("#musicList .mtrack").length')) >= 5);
  t('音乐支持导入本地音乐', (await js('!!document.querySelector("#musicFile")')) === true);
  t('音乐有定时停止', (await js('document.querySelectorAll(".music-timers .seg-btn").length')) === 5);
  await js('document.querySelectorAll("#musicList .mtrack")[0].click()');
  await sleep(400);
  t('点击曲目后有播放状态', (await js('BG.music.state().track !== null')) === true);
  t('播放后出现迷你播放器', (await js('!document.querySelector("#musicDock").classList.contains("is-hidden")')) === true);
  await js('document.querySelector("[data-action=close-modal]").click()');
  await sleep(200);
  t('收起音乐后音乐继续', (await js('BG.music.state().playing')) === true);
  await js('document.querySelector("#musicDock [data-action=music-stop]").click()');
  await sleep(200);
  t('可以停止音乐', (await js('BG.music.state().playing')) === false);

  await js('document.querySelector("[data-action=open-study]").click()');
  await waitFor('!!document.querySelector(".study-item")', '自习室建议任务');
  t('自习室给出今天任务', (await js('document.querySelectorAll(".study-item").length')) >= 1);
  t('自习室不含社团和其他活动',
    (await js('document.querySelector(".study-modal").textContent.indexOf("篮球社训练") === -1')) === true);
  const studyBefore = await js('document.querySelector("#studyTotalNum").textContent');
  await js(`var studyEl=document.querySelector('[data-study-min="0"]'); studyEl.value="15"; studyEl.dispatchEvent(new Event("change",{bubbles:true}))`);
  await sleep(250);
  t('可以修改预期时间', (await js('document.querySelector("#studyTotalNum").textContent')) !== studyBefore);
  await js('document.querySelector("[data-action=study-start]").click()');
  await waitFor('!!document.querySelector("#studyClock")', '自习室倒计时');
  t('自习室开始倒计时', (await js('!!document.querySelector("#studyClock")')) === true);
  await js(`(() => {
    for (let i = 0; i < 8; i++) {
      const inputs = document.querySelectorAll('.study-run-item input');
      if (!inputs.length || inputs.length <= i) break;
      const el = document.querySelectorAll('.study-run-item input')[i];
      if (el && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  })()`);
  await sleep(300);
  t('勾完会放开结算按钮', (await js('!!document.querySelector("[data-action=study-finish-early]")')) === true);
  await js('document.querySelector("[data-action=study-finish-early]").click()');
  await waitFor('!!document.querySelector(".study-result")', '自习室结算');
  t('自习室有结算页', (await js('!!document.querySelector(".study-result")')) === true);
  await js('document.querySelector("[data-action=study-close]").click()');
  await sleep(200);
  t('结算后可以回到页面', (await js('!document.querySelector("#modalRoot").innerHTML.trim()')) === true);

  console.log('\n== F. 页面无脚本错误 ==');
  const errs = await js('window.__errs ? window.__errs.slice(0, 6) : []');
  t('无未捕获异常', errs.length === 0, errs);
} catch (e) {
  fail++;
  console.log('\n  ERROR ' + e.message);
} finally {
  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
  try { ws.close(); } catch (e) { }
  browser.kill();
  await sleep(400);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { }
  process.exit(fail ? 1 : 0);
}
