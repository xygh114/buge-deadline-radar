/* ============================================================
   不鸽 · 学校档案导入【最终版】
   纯函数：把学校/教务导出的 txt、csv、json 里的绩点、学分、
   学校要求读成设置字段；文件只在浏览器里用 FileReader 读，不上传。
   ============================================================ */
window.BG = window.BG || {};

(function (BG) {
  'use strict';

  var ALIASES = {
    gpaCurrent: ['gpacurrent', 'currentgpa', 'current_gpa', '当前绩点', '当前gpa', '绩点'],
    gpaTarget: ['gpatarget', 'targetgpa', 'target_gpa', '目标绩点', '目标gpa'],
    gpaScale: ['gpascale', 'scale', '绩点制', '满分绩点'],
    creditsEarned: ['creditsEarned', 'earnedcredits', 'credits_earned', '已修学分', '已获学分', '已修'],
    creditsRequired: ['creditsRequired', 'requiredcredits', 'credits_required', '毕业学分', '要求学分', '总学分', '毕业要求学分'],
    schoolRequirement: ['schoolRequirement', 'school_requirement', '学校要求', '教务要求', '毕业要求', '保研线'],
    careerGoal: ['careerGoal', 'career_goal', '职业规划', '生涯目标', '职业目标']
  };

  function normKey(k) {
    return String(k || '').toLowerCase().replace(/[\s_\-]/g, '');
  }

  var LOOKUP = {};
  Object.keys(ALIASES).forEach(function (field) {
    LOOKUP[normKey(field)] = field;
    ALIASES[field].forEach(function (alias) { LOOKUP[normKey(alias)] = field; });
  });

  function num(v, field) {
    if (v == null || String(v).trim() === '') return null;
    var n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
    if (!isFinite(n)) return null;
    if (field === 'gpaCurrent' || field === 'gpaTarget') return Math.max(0, Math.min(5, n));
    if (field === 'gpaScale') return Math.max(1, Math.min(5, n));
    if (field === 'creditsEarned' || field === 'creditsRequired') return Math.max(0, Math.min(400, n));
    return n;
  }

  function assign(out, key, value) {
    var field = LOOKUP[normKey(key)];
    if (!field) return false;
    if (field === 'schoolRequirement' || field === 'careerGoal') {
      out[field] = String(value == null ? '' : value).trim();
    } else {
      var n = num(value, field);
      if (n != null) out[field] = n;
    }
    return true;
  }

  function splitLine(line) {
    var s = String(line || '').trim();
    if (!s || s.charAt(0) === '#') return null;
    var m = s.match(/^([^=:：,，\t]+)\s*[=:：,，\t]\s*(.*)$/);
    if (!m) return null;
    return { key: m[1], value: m[2] };
  }

  function parseLoose(text, out) {
    String(text).split(/\r?\n/).forEach(function (line) {
      var pair = splitLine(line);
      if (pair) assign(out, pair.key, pair.value);
    });
  }

  function parseJson(text, out) {
    var obj = JSON.parse(text);
    if (obj && obj.settings && typeof obj.settings === 'object') obj = obj.settings;
    if (Array.isArray(obj)) {
      /* 只给课程数组时，至少把已修学分加出来 */
      var earned = 0;
      obj.forEach(function (c) { earned += parseFloat(c && (c.credits || c.学分)) || 0; });
      if (earned > 0) out.creditsEarned = Math.min(400, earned);
      return;
    }
    Object.keys(obj || {}).forEach(function (k) { assign(out, k, obj[k]); });
    if (Array.isArray(obj && obj.courses) && out.creditsEarned == null) {
      var sum = 0;
      obj.courses.forEach(function (c) { sum += parseFloat(c && (c.credits || c.学分)) || 0; });
      if (sum > 0) out.creditsEarned = Math.min(400, sum);
    }
  }

  function parse(text, filename) {
    var raw = String(text == null ? '' : text).replace(/^\uFEFF/, '').trim();
    if (!raw) throw new Error('文件是空的');
    var out = {};
    if (/\.json$/i.test(filename || '') || /^[\[{]/.test(raw)) {
      try { parseJson(raw, out); }
      catch (e) { throw new Error('JSON 格式不对：' + e.message); }
    } else {
      parseLoose(raw, out);
    }
    if (!Object.keys(out).length) {
      throw new Error('没读到绩点或学分：请用「字段=值」的 txt / csv，或 JSON');
    }
    return {
      settings: out,
      fields: Object.keys(out),
      source: filename || '本地文件'
    };
  }

  function example() {
    return [
      '# 不鸽 · 学校档案模板（txt / csv 都可以，字段=值）',
      'gpaCurrent=3.42',
      'gpaTarget=3.72',
      'gpaScale=4',
      'creditsEarned=96',
      'creditsRequired=160',
      'schoolRequirement=毕业需 160 学分；保研/奖学金参考绩点 3.5 以上',
      'careerGoal=成为算法工程师：先打好数据结构与算法基础'
    ].join('\n');
  }

  BG.profile = {
    parse: parse,
    example: example,
    aliases: ALIASES
  };
})(window.BG);
