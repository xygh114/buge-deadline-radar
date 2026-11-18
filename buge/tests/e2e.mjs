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
  t('今日计划已生成', (await js('document.querySelectorAll(".plan-item").length')) >= 1);
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
  await js('document.querySelector("#importBtn").click()');
  await waitFor('!document.querySelector("#noticeInput")', '弹层关闭');
  await sleep(200);
  const after = await js('BG.store.get().tasks.length');
  t('导入后新增 2 条、跳过 1 条重复', after === before + 2, { before, after });
  t('导入后首屏刷新', (await js('document.querySelectorAll("#taskList .task").length')) === after);
  t('重复通知不会重复提醒（去重生效）', after === 10);

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
  if (editOpen) {
    await js('document.querySelector("[data-action=close-modal]").click()');
  }

  console.log('\n== D. 刷新持久化 ==');
  await send('Page.reload', { ignoreCache: true });
  await sleep(1200);
  await waitFor('!!document.querySelector("#taskList .task")', '刷新后渲染');
  t('刷新后任务数不变', (await js('BG.store.get().tasks.length')) === after);
  t('刷新后完成状态保留', (await js(`BG.store.get().tasks.find(t=>t.id==="${firstId}").status`)) === 'done');

  console.log('\n== E. 设置与导出 ==');
  await js('document.querySelector("[data-action=view][data-view=settings]").click()');
  await waitFor('!!document.querySelector("#dailyHours")', '设置页');
  await js('const r=document.querySelector("#dailyHours"); r.value="5"; r.dispatchEvent(new Event("change",{bubbles:true}))');
  await sleep(250);
  t('每日预算改为 5 小时', (await js('BG.store.get().settings.dailyHours')) === 5);
  t('设置页公式说明存在', (await js('document.querySelector(".formula-main").textContent')).includes('52%'));

  const ics = await js('BG.model.toIcs(BG.store.get().tasks)');
  t('ICS 有日历头', ics.startsWith('BEGIN:VCALENDAR'));
  t('ICS 事件数 = 未完成任务数', (ics.match(/BEGIN:VEVENT/g) || []).length === (await js('BG.store.get().tasks.filter(t=>t.status!=="done").length')));
  t('ICS 带 VALARM 提醒', ics.includes('TRIGGER:-PT6H'));

  const total = await js('BG.store.get().tasks.length');
  const done = await js('BG.store.get().tasks.filter(t=>t.status==="done").length');
  t('数据统计自洽', total === 10 && done === 2, { total, done });

  console.log('\n== F. 页面无脚本错误 ==');
  const errs = await js('window.__errs ? window.__errs.length : 0');
  t('无未捕获异常', errs === 0, errs);
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
