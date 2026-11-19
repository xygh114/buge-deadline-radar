/* 学校档案导入回归测试：node tests/profile.test.js */
global.window = global;
require('../assets/profile.js');
const BG = global.BG;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function p(text, name) { return BG.profile.parse(text, name || 'x.txt'); }

console.log('\n== 1. txt 字段=值 ==');
{
  const r = p('gpaCurrent=3.42\ngpaTarget=3.72\ncreditsEarned=96\ncreditsRequired=160\nschoolRequirement=毕业需 160 学分');
  check('读出当前绩点', r.settings.gpaCurrent === 3.42, r.settings);
  check('读出目标绩点', r.settings.gpaTarget === 3.72);
  check('读出已修学分', r.settings.creditsEarned === 96);
  check('读出毕业学分', r.settings.creditsRequired === 160);
  check('读出学校要求', r.settings.schoolRequirement === '毕业需 160 学分');
  check('字段计数', r.fields.length === 5, r.fields);
}

console.log('\n== 2. 中文键 / csv / 冒号 ==');
{
  const r = p('当前绩点：3.3\n目标绩点,3.8\n已修学分=80\n毕业要求学分: 150\n职业规划=做产品经理');
  check('中文当前绩点', r.settings.gpaCurrent === 3.3, r.settings);
  check('中文目标绩点', r.settings.gpaTarget === 3.8);
  check('中文已修学分', r.settings.creditsEarned === 80);
  check('中文毕业学分', r.settings.creditsRequired === 150);
  check('中文职业规划', r.settings.careerGoal === '做产品经理');
}

console.log('\n== 3. JSON ==');
{
  const r = p('{"gpaCurrent":3.5,"gpaTarget":3.9,"creditsEarned":100,"creditsRequired":170,"schoolRequirement":"保研 3.6"}', 'x.json');
  check('JSON 当前绩点', r.settings.gpaCurrent === 3.5);
  check('JSON 目标绩点', r.settings.gpaTarget === 3.9);
  check('JSON 学分', r.settings.creditsEarned === 100 && r.settings.creditsRequired === 170);
  check('JSON 学校要求', r.settings.schoolRequirement === '保研 3.6');

  const nested = p('{"settings":{"当前绩点":3.1,"目标绩点":3.6}}', 'x.json');
  check('嵌套 settings', nested.settings.gpaCurrent === 3.1 && nested.settings.gpaTarget === 3.6);
}

console.log('\n== 4. 课程数组只加学分 ==');
{
  const r = p('{"courses":[{"credits":3},{"学分":4},{"credits":2.5}]}', 'x.json');
  check('课程学分求和', r.settings.creditsEarned === 9.5, r.settings.creditsEarned);
}

console.log('\n== 5. 边界与报错 ==');
{
  const r = p('gpaCurrent=9\ngpaTarget=-1\ncreditsEarned=9999');
  check('绩点夹到 0–5', r.settings.gpaCurrent === 5 && r.settings.gpaTarget === 0, r.settings);
  check('学分夹到 400', r.settings.creditsEarned === 400);
  let err = null;
  try { p('   ', 'x.txt'); } catch (e) { err = e; }
  check('空文件报错', !!err, err && err.message);
  err = null;
  try { p('hello world', 'x.txt'); } catch (e) { err = e; }
  check('无字段报错', !!err, err && err.message);
  err = null;
  try { p('{bad json', 'x.json'); } catch (e) { err = e; }
  check('坏 JSON 报错', !!err, err && err.message);
}

console.log('\n== 6. 模板能被自己解析 ==');
{
  const r = p(BG.profile.example(), 'template.txt');
  check('模板含 7 个字段', r.fields.length === 7, r.fields);
  check('模板职业规划', /算法工程师/.test(r.settings.careerGoal), r.settings.careerGoal);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
