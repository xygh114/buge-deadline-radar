/* ============================================================
   不鸽 · 通知解析引擎（规则 + 启发式，纯本地运行）
   目标：把一段“平台/群通知”拆成结构化任务草稿。
   设计原则：宁可能识别、可解释、可修正，也不假装是黑盒。
   ============================================================ */
window.BG = window.BG || {};

(function (BG) {
  'use strict';

  /* ---------------- 时间工具 ---------------- */
  var DAY = 86400000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }

  function mondayOf(d) {
    var x = startOfDay(d);
    var wd = (x.getDay() + 6) % 7; // 周一=0
    x.setDate(x.getDate() - wd);
    return x;
  }

  /* 学期第 1 教学周周一（可在设置里手动改） */
  BG.semesterStart = function (now) {
    now = now || new Date();
    var y = now.getFullYear();
    var fall = mondayOf(new Date(y, 8, 1));
    var spring = mondayOf(new Date(y, 1, 24));
    if (now >= fall) return fall;
    if (now >= spring) return spring;
    return mondayOf(new Date(y - 1, 8, 1));
  };

  BG.teachingWeek = function (now, semStart) {
    var s = semStart || BG.semesterStart(now);
    var w = Math.floor((startOfDay(now) - startOfDay(s)) / (7 * DAY)) + 1;
    return Math.max(1, w);
  };

  BG.util = {
    pad: pad,
    startOfDay: startOfDay,
    addDays: addDays,
    mondayOf: mondayOf,
    WEEK: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    weekLabel: function (d) { return BG.util.WEEK[(d.getDay() + 6) % 7]; },
    fmtMonthDay: function (ts) { var d = new Date(ts); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; },
    fmtTime: function (ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); },
    fmtDateTime: function (ts) { return BG.util.fmtMonthDay(ts) + ' ' + BG.util.fmtTime(ts); },
    toLocalInput: function (ts) {
      var d = new Date(ts);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    },
    fromLocalInput: function (v) { return v ? new Date(v).getTime() : null; },
    humanHours: function (h) {
      if (h == null) return '—';
      if (h < 1) return Math.round(h * 60) + ' 分钟';
      var s = (Math.round(h * 10) / 10).toString();
      return s + ' 小时';
    },
    /* 剩余时间的人话：已逾期 6 小时 / 还剩 2 天 3 小时 */
    countdown: function (ms) {
      var past = ms < 0;
      var abs = Math.abs(ms);
      var d = Math.floor(abs / DAY);
      var h = Math.floor((abs % DAY) / 3600000);
      var m = Math.round((abs % 3600000) / 60000);
      var out;
      if (d > 0) out = d + ' 天' + (h ? ' ' + h + ' 小时' : '');
      else if (h > 0) out = h + ' 小时' + (m ? ' ' + m + ' 分' : '');
      else out = Math.max(m, 1) + ' 分钟';
      return (past ? '逾期 ' : '剩 ') + out;
    }
  };

  /* ---------------- 文本指纹 ---------------- */
  BG.hash = function (str) {
    var h = 5381, i = str.length;
    while (i) h = (h * 33) ^ str.charCodeAt(--i);
    return (h >>> 0).toString(36);
  };

  /* ---------------- 时间表达 ---------------- */
  var WEEKDAY = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };

  function scanTimes(text) {
    var re = /(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})\s*(?:[:：]\s*(\d{1,2})|[点時时]\s*(半|\d{1,2})?\s*分?)/g;
    var out = [], m;
    while ((m = re.exec(text)) !== null) {
      var h = parseInt(m[2], 10);
      var mi = 0;
      if (m[3] != null) mi = parseInt(m[3], 10);
      else if (m[4] === '半') mi = 30;
      else if (m[4] != null) mi = parseInt(m[4], 10);
      if (h > 24 || mi > 59) continue;
      var period = m[1] || '';
      if (period && h < 12 && (period === '下午' || period === '傍晚' || period === '晚上')) h += 12;
      if (period === '中午' && h < 11) h += 12;
      if (h === 24) { h = 23; mi = 59; } // “今晚 24 点”按当天 23:59 截止处理
      if (h > 23) continue;
      out.push({ h: h, m: mi, index: m.index, text: m[0] });
    }
    return out;
  }

  function pickTime(text, dateStart, dateEnd) {
    var after = scanTimes(text.slice(dateEnd, dateEnd + 24));
    if (after.length) return after[0];
    var before = scanTimes(text.slice(Math.max(0, dateStart - 20), dateStart));
    if (before.length) return before[before.length - 1];
    var all = scanTimes(text);
    return all.length ? all[0] : null;
  }

  function safeDate(y, mo, d, h, mi) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, mo - 1, d, h == null ? 23 : h, mi == null ? 59 : mi, 0, 0);
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  function inferYear(mo, d, now) {
    var y = now.getFullYear();
    var cand = safeDate(y, mo, d, 12, 0);
    if (!cand) return y;
    if ((now - cand) / DAY > 200) return y + 1;
    return y;
  }

  function fromWeekday(now, weekday, mode) {
    var base = mondayOf(now);
    if (mode === 'next') base = addDays(base, 7);
    if (mode === 'next2') base = addDays(base, 14);
    if (!mode) {
      // “周五”这种裸写法：取未来最近的一次（今天算）
      var today = startOfDay(now);
      var cur = (today.getDay() + 6) % 7; // 0=Mon
      var diff = weekday - 1 - cur;
      if (diff < 0) diff += 7;
      return addDays(today, diff);
    }
    return addDays(base, weekday - 1);
  }

  var DATE_RULES = [
    { name: 'ymd', re: /20\d{2}\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*[日号]?/ },
    { name: 'md', re: /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/ },
    { name: 'weekNo', re: /第\s*(\d{1,2})\s*周\s*(?:周|星期)?\s*([一二三四五六日天])/ },
    { name: 'weekday', re: /(下下|下|本|这)?\s*(?:周|星期)\s*([一二三四五六日天])/ },
    { name: 'relative', re: /(大后天|后天|明天|明晚|今晚|今天)/ },
    { name: 'slash', re: /(?<![\d.])(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d:：]|\s*(?:小时|h|分|个|倍|%|元))/ }
  ];

  function extractDue(text, now, semStart) {
    for (var i = 0; i < DATE_RULES.length; i++) {
      var rule = DATE_RULES[i];
      var m = rule.re.exec(text);
      if (!m) continue;

      var day = null, hasExplicitYear = false;
      if (rule.name === 'ymd') {
        day = safeDate(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
        hasExplicitYear = true;
      } else if (rule.name === 'md') {
        day = safeDate(inferYear(parseInt(m[1], 10), parseInt(m[2], 10), now), parseInt(m[1], 10), parseInt(m[2], 10));
      } else if (rule.name === 'weekNo') {
        var n = parseInt(m[1], 10), wd = WEEKDAY[m[2]];
        if (n > 0 && n < 30 && wd) {
          var s = semStart || BG.semesterStart(now);
          day = addDays(s, (n - 1) * 7 + (wd - 1));
        }
      } else if (rule.name === 'weekday') {
        var mode = m[1] === '下' ? 'next' : m[1] === '下下' ? 'next2' : (m[1] === '本' || m[1] === '这') ? 'this' : null;
        if (mode === 'this') {
          day = addDays(mondayOf(now), WEEKDAY[m[2]] - 1);
        } else {
          day = fromWeekday(now, WEEKDAY[m[2]], mode);
        }
      } else if (rule.name === 'relative') {
        var map = { '今天': 0, '今晚': 0, '明天': 1, '明晚': 1, '后天': 2, '大后天': 3 };
        day = addDays(now, map[m[1]]);
      } else if (rule.name === 'slash') {
        day = safeDate(inferYear(parseInt(m[1], 10), parseInt(m[2], 10), now), parseInt(m[1], 10), parseInt(m[2], 10));
      }

      if (!day) continue;

      var t = pickTime(text, m.index, m.index + m[0].length);
      day.setHours(t ? t.h : 23, t ? t.m : 59, 0, 0);
      return {
        ts: day.getTime(),
        matched: m[0],
        hasTime: !!t,
        kind: rule.name,
        explicitYear: hasExplicitYear
      };
    }
    return null;
  }

  /* ---------------- 字段抽取 ---------------- */
  function detectPlatform(text) {
    var lower = text.toLowerCase();
    var VENUE = /(提交|交至|上交|上传|发至|发送|交到|传到|发布在)/;
    var best = null;
    BG.PLATFORMS.forEach(function (p) {
      p.keywords.forEach(function (kw) {
        var from = 0, idx;
        while ((idx = lower.indexOf(kw.toLowerCase(), from)) !== -1) {
          var before = text.slice(Math.max(0, idx - 10), idx);
          var score = (VENUE.test(before) ? 3 : 0) - idx / 10000;
          if (!best || score > best.score || (score === best.score && kw.length > best.len)) {
            best = { id: p.id, idx: idx, len: kw.length, score: score, kw: kw };
          }
          from = idx + kw.length;
        }
      });
    });
    return best;
  }

  var TASK_WORDS = /(作业|习题|实验|报告|论文|测验|考试|展示|汇报|讨论|互评|签到|课程设计|大作业|读书报告|读书笔记|项目|设计|PPT|ppt|答辩|验收)/;

  function detectCourse(text, platformKw) {
    var m = text.match(/【\s*([^】]{2,24})\s*】/);
    if (m && !TASK_WORDS.test(m[1])) return { course: m[1].trim(), level: 'high' };

    m = text.match(/《\s*([^》]{2,30})\s*》/);
    if (m) return { course: m[1].trim(), level: 'high' };

    m = text.match(/课程\s*[:：]\s*([^\s，。；,]{2,20})/);
    if (m) return { course: m[1].trim(), level: 'high' };

    // “马克思主义基本原理课程论文” 这类把课程写进任务名的写法
    m = text.match(/([\u4e00-\u9fa5A-Za-z]{2,16})(?:课程论文|课程设计|大作业|期末论文|读书报告)/);
    if (m) return { course: m[1].trim(), level: 'med' };

    // “学习通 · 数据结构” 这样的平台 + 课程抬头
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var lm = line.match(/^([^\s·\-—|]{2,16})\s*[·\-—|]\s*([^\s·\-—|]{2,20})$/);
      if (lm) {
        var pk = (platformKw || '').toLowerCase();
        var left = lm[1].toLowerCase();
        var isPlatform = pk && (left.indexOf(pk) !== -1 || pk.indexOf(left) !== -1);
        if (isPlatform) return { course: lm[2].trim(), level: 'high' };
      }
      if (line.indexOf('·') !== -1) {
        var parts = line.split('·');
        if (parts.length >= 2) {
          var cand = parts[parts.length - 1].trim();
          if (cand.length >= 2 && cand.length <= 20 && !TASK_WORDS.test(cand) && !/\d/.test(cand)) {
            return { course: cand, level: 'med' };
          }
        }
      }
    }

    // “高等数学A(上)第11周作业” 这种没有括号的情况
    m = text.match(/^([\u4e00-\u9fa5A-Za-z()（）]{2,18}?)(?:第\s*\d+\s*[周章讲]|实验|作业|课程论文|单元测验)/);
    if (m) {
      var guess = m[1].trim();
      if (guess.length >= 3 && !/^(请|关于|通知|注意|各位|同学们)/.test(guess)) {
        return { course: guess, level: 'med' };
      }
    }
    return { course: '', level: 'none' };
  }

  function detectWeight(text) {
    var m = text.match(/(?:占总评|占比|占平时分|占期末|权重|计入)[^\d%]{0,10}(\d{1,3})\s*[%％]/);
    if (m) return { weight: parseInt(m[1], 10), level: 'high' };
    m = text.match(/(\d{1,3})\s*[%％]/);
    if (m) return { weight: parseInt(m[1], 10), level: 'med' };
    return { weight: null, level: 'none' };
  }

  function detectEstHours(text, typeId) {
    var m = text.match(/(\d+(?:\.\d+)?)\s*(?:个)?\s*(?:小时|h|hour)/i);
    if (m) return { estHours: Math.min(60, parseFloat(m[1])), level: 'high' };
    return { estHours: BG.typeById(typeId).hours, level: 'default' };
  }

  function stripPlatform(str) {
    var out = str;
    BG.PLATFORMS.forEach(function (p) {
      p.keywords.forEach(function (kw) {
        var re = new RegExp('^\\s*' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[·\\-—|:：]*\\s*', 'i');
        out = out.replace(re, '');
      });
    });
    return out;
  }

  function cleanTitle(raw, course) {
    var t = String(raw || '')
      .replace(/【[^】]*】/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // “请于……前提交实验报告” → 取动词后面的宾语
    var m = t.match(/(?:提交|上交|上传|交至|发至|交)\s*(.{2,40})$/);
    if (m) t = m[1];

    t = stripPlatform(t);
    t = t.replace(/^[（(][^）)]{1,10}[）)]\s*/, '');                       // （辅导员）
    t = t.replace(/^(群通知|班级群通知|群消息|班级通知|通知|公告|提醒|重要通知)\s*[（(][^）)]{0,12}[）)]?\s*[:：]?\s*/, '');
    t = t.replace(/^(各位同学|同学们|大家|各位)\s*[，,：:]?\s*/, '');        // 称呼
    t = t.replace(/^(\d{1,2}\s*[.、)）]|[-*•·])\s*/, '');                  // 编号

    // 去掉开头的时间状语（“第 11 周”这种跟作业连用的保留）
    t = t.replace(/^(今天|今晚|明天|明晚|后天|大后天|本?周[一二三四五六日天]|下{1,2}周[一二三四五六日天]|第\s*\d+\s*周(?=\s*[周星期]))\s*/g, '');
    t = t.replace(/^\d{1,2}\s*[月/.]\s*\d{1,2}\s*[日号]?\s*/, '');
    t = t.replace(/^\d{1,2}\s*[:：]\s*\d{2}\s*/, '');
    t = t.replace(/^(上午|早上|下午|傍晚|晚上|中午)\s*\d{1,2}\s*[点時时]\s*(半|\d{1,2})?\s*(分)?\s*/, '');
    t = t.replace(/^(进行|开展|完成|开始)\s*/, '');

    t = t.split(/截止|提交时间|截止时间|请于|请务必|请注意|逾期|已发布|已布置|占[总平期]|（?大约?需?要?\s*\d/)[0];
    t = t.split(/\s*(?:下?周[一二三四五六日天]|今天|明天|后天|\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{1,2}\s*[:：]\s*\d{2})/)[0];
    t = t.replace(/^[\s,，。；;:：、·\-—]+|[\s,，。；;:：、]+$/g, '');
    if (course && t.indexOf(course) === 0) t = t.slice(course.length).replace(/^[\s·\-—:：]+/, '');
    t = t.replace(/^(请|务必|记得|注意|需要)?\s*(完成|提交|上交|提交一份|上传|在)\s*/, '');
    t = t.replace(/^(课程)\s*(作业|实验|报告)/, '$2');
    t = t.trim();
    if (!t) return '';
    if (t.length > 32) t = t.slice(0, 32) + '…';
    return t;
  }

  function guessTitle(block, course) {
    var body = block.replace(/\n/g, ' ');

    var clauses = body.split(/[。；;，,]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var scored = clauses.map(function (c, i) {
      var s = 0;
      if (TASK_WORDS.test(c)) s += 6;
      if (/第\s*\d+\s*周/.test(c) && /(作业|习题)/.test(c)) s += 3;
      if (/实验\s*[一二三四五六七八九十\d]/.test(c)) s += 2;
      if (/^\s*(请|务必|记得|注意)/.test(c)) s -= 2;
      if (/(中国大学mooc|学习通|雨课堂|智慧树)/i.test(c)) s -= 1;
      s -= i * 0.4;
      return { c: c, s: s };
    }).sort(function (a, b) { return b.s - a.s; });

    for (var i = 0; i < scored.length; i++) {
      var t = cleanTitle(scored[i].c, course);
      if (t && t.length >= 2) return t;
    }
    return cleanTitle(clauses[0] || '', course);
  }

  /* ---------------- 分条 ---------------- */
  var HAS_DATE = /\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{1,2}\s*[:：]\s*\d{2}|20\d{2}\s*[-/.]/;
  var BULLET = /^(\d{1,2}[.、)）]|[-*•·])\s*/;

  function splitBlocks(raw) {
    var text = String(raw || '').replace(/\r\n?/g, '\n').trim();
    if (!text) return [];
    var paras = text.split(/\n\s*\n+/);
    var blocks = [];

    paras.forEach(function (p) {
      var lines = p.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!lines.length) return;
      if (lines.length === 1 || !lines.some(function (l) { return BULLET.test(l); })) {
        blocks.push(p);
        return;
      }

      // 有编号的段落：抬头（如【数据结构】实验五）作为整段的公共前缀
      var headLines = [], i = 0;
      while (i < lines.length && !BULLET.test(lines[i])) { headLines.push(lines[i]); i++; }
      var head = headLines.join('\n').trim();
      var headHasDate = HAS_DATE.test(head);

      var items = [], cur = '';
      for (; i < lines.length; i++) {
        var l = lines[i];
        if (BULLET.test(l)) {
          if (cur) items.push(cur);
          cur = l;
        } else {
          cur = cur ? cur + '\n' + l : l;
        }
      }
      if (cur) items.push(cur);

      if (headHasDate) blocks.push(head);
      if (!items.length && head) blocks.push(head);
      items.forEach(function (item) {
        var body = item.replace(BULLET, '');
        blocks.push(head && !headHasDate ? head + '\n' + body : body);
      });
    });

    return blocks.filter(function (b) { return b.trim().length > 0; });
  }

  /* ---------------- 主入口 ---------------- */
  BG.parseNotices = function (raw, opts) {
    opts = opts || {};
    var now = opts.now ? new Date(opts.now) : new Date();
    var semStart = opts.semStart || BG.semesterStart(now);
    var blocks = splitBlocks(raw);
    var drafts = [], failed = [];

    blocks.forEach(function (block, i) {
      var due = extractDue(block, now, semStart);
      if (!due) {
        failed.push({ index: i, text: block.replace(/\s+/g, ' ').slice(0, 60), reason: '没有找到明确的截止时间' });
        return;
      }
      var plat = detectPlatform(block);
      var platformId = plat ? plat.id : 'manual';
      var platformName = plat ? BG.platformById(plat.id).name : '';
      var courseInfo = detectCourse(block, plat ? plat.kw : '');
      var typeId = BG.typeOf(block);
      var weightInfo = detectWeight(block);
      var estInfo = detectEstHours(block, typeId);
      var title = guessTitle(block, courseInfo.course);

      drafts.push({
        id: 'draft-' + BG.hash(block + now.getTime()),
        title: title || '未命名任务',
        course: courseInfo.course,
        platform: platformId,
        type: typeId,
        dueAt: due.ts,
        weight: weightInfo.weight,
        estHours: estInfo.estHours,
        raw: block,
        match: due.matched,
        confidence: {
          due: due.hasTime ? 'high' : 'med',
          course: courseInfo.level,
          platform: plat ? 'high' : 'none',
          weight: weightInfo.level,
          estHours: estInfo.level
        }
      });
    });

    return { drafts: drafts, failed: failed, blockCount: blocks.length };
  };

  /* 给测试与说明页用 */
  BG._internal = { extractDue: extractDue, scanTimes: scanTimes, splitBlocks: splitBlocks, cleanTitle: cleanTitle, guessTitle: guessTitle, detectCourse: detectCourse };
})(window.BG);
