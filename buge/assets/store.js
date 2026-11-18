/* ============================================================
   不鸽 · 状态与算法层
   - 本地持久化（localStorage，失败时退回内存）
   - 优先级评分、今日作战计划、提醒队列、周负荷、.ics 导出
   ============================================================ */
window.BG = window.BG || {};

(function (BG) {
  'use strict';

  var DAY = 86400000, HOUR = 3600000;
  var U = BG.util;

  /* ---------------- 基础计算 ---------------- */
  function remainingHours(t) {
    var p = Math.max(0, Math.min(100, t.progress || 0));
    return Math.max(0, (t.estHours || 0) * (1 - p / 100));
  }

  function hoursLeft(t, now) { return (t.dueAt - now) / HOUR; }

  /* 优先级：时间紧迫度 52% + 成绩权重 26% + 时间不够的风险 22% */
  function rawScore(t, now) {
    var hl = hoursLeft(t, now);
    var urgency = hl <= 0 ? 1 : Math.exp(-hl / 60);
    var weight = Math.min((t.weight == null ? 8 : t.weight) / 30, 1);
    var risk = Math.min(remainingHours(t) / Math.max(hl, 0.75), 1.5) / 1.5;
    return 0.52 * urgency + 0.26 * weight + 0.22 * risk;
  }

  function score(t, now) {
    return Math.round(100 * Math.sqrt(rawScore(t, now)));
  }

  function bucket(t, now) {
    if (t.status === 'done') return 'done';
    var hl = hoursLeft(t, now);
    if (hl < 0) return 'overdue';
    if (hl <= 24) return 'critical';
    if (hl <= 72) return 'soon';
    if (hl <= 168) return 'week';
    return 'later';
  }

  /* 给“为什么先做它”生成一句可解释的理由 */
  function reason(t, now) {
    var hl = hoursLeft(t, now);
    var rem = remainingHours(t);
    var bits = [];
    if (hl < 0) bits.push('已经逾期，越晚补救代价越大');
    else if (hl <= 24) bits.push(Math.max(1, Math.round(hl)) + ' 小时后截止');
    else bits.push('还有 ' + U.countdown(hl * HOUR).replace('剩 ', ''));
    if (t.weight >= 20) bits.push('占总评 ' + t.weight + '%');
    if (rem > Math.max(hl, 1) * 0.5 && rem > 1) bits.push('还需 ' + U.humanHours(rem) + '，时间偏紧');
    if (rem > 0 && rem <= 1 && hl > 0) bits.push('收尾量不大，可以顺手清掉');
    return bits.join(' · ');
  }

  /* ---------------- 今日作战计划 ---------------- */
  var MEALS = [[12 * 60, 13 * 60 + 30], [18 * 60, 19 * 60]];

  function isMeal(d) {
    var m = d.getHours() * 60 + d.getMinutes();
    return MEALS.some(function (x) { return m >= x[0] && m < x[1]; });
  }

  function ceilTo(d, minutes) {
    var x = new Date(d.getTime());
    x.setSeconds(0, 0);
    var m = x.getMinutes();
    var add = (minutes - (m % minutes)) % minutes;
    x.setMinutes(m + add);
    return x;
  }

  function atClock(day, h, m) {
    var d = new Date(day.getTime());
    d.setHours(h, m, 0, 0);
    return d;
  }

  function buildSlots(now, settings) {
    var start = new Date(now.getTime() + 5 * 60 * 1000);
    start = ceilTo(start, 15);
    var today = new Date(now.getTime());
    if (start.getHours() < 8) start = atClock(today, 8, 30);
    if (start.getHours() >= 23 || (start.getHours() === 22 && start.getMinutes() > 30)) return [];

    var endOfDay = atClock(today, 23, 30);
    var slots = [];
    var cursor = new Date(start.getTime());
    var budget = Math.max(0.5, settings.dailyHours || 3);
    var maxSlots = Math.ceil(budget / 0.75);

    while (cursor < endOfDay && slots.length < maxSlots) {
      if (isMeal(cursor)) {
        cursor = new Date(cursor.getTime() + 15 * 60000);
        continue;
      }
      var end = new Date(Math.min(cursor.getTime() + 45 * 60000, endOfDay.getTime()));
      // 不要跨过饭点：把这一块在饭点前收住，太短就直接挪到饭后
      for (var i = 0; i < MEALS.length; i++) {
        var mealStart = new Date(cursor.getTime());
        mealStart.setHours(0, MEALS[i][0], 0, 0);
        if (cursor < mealStart && mealStart < end) { end = mealStart; }
        if (end - cursor < 12 * 60000 && end.getTime() === mealStart.getTime()) {
          cursor = new Date(cursor.getTime());
          cursor.setHours(0, MEALS[i][1], 0, 0);
          end = null;
          break;
        }
      }
      if (!end) continue;
      slots.push({ start: new Date(cursor.getTime()), end: end });
      cursor = new Date(end.getTime() + 10 * 60000);
    }
    return slots;
  }

  function buildPlan(tasks, now, settings) {
    now = now instanceof Date ? now : new Date(now);
    var open = tasks.filter(function (t) { return t.status !== 'done'; })
      .sort(function (a, b) { return rawScore(b, now) - rawScore(a, now); });
    var slots = buildSlots(now, settings);
    var blocks = [];
    var ti = 0, need = open.length ? remainingHours(open[0]) : 0;
    var totalNeeded = open.reduce(function (s, t) { return s + remainingHours(t); }, 0);

    slots.forEach(function (slot) {
      var hours = (slot.end - slot.start) / HOUR;
      while (ti < open.length && need <= 0.01) {
        ti++;
        need = ti < open.length ? remainingHours(open[ti]) : 0;
      }
      if (ti >= open.length) return;
      var take = Math.min(hours, need);
      blocks.push({
        taskId: open[ti].id,
        start: new Date(slot.start.getTime()),
        end: new Date(slot.start.getTime() + take * HOUR),
        hours: take
      });
      need -= take;
    });

    var scheduled = blocks.reduce(function (s, b) { return s + b.hours; }, 0);
    return {
      blocks: blocks,
      scheduledHours: scheduled,
      totalNeeded: totalNeeded,
      overflow: Math.max(0, totalNeeded - scheduled),
      budget: settings.dailyHours || 3,
      late: slots.length === 0
    };
  }

  /* ---------------- 提醒 ---------------- */
  var OFFSETS = [
    { ms: -72 * HOUR, label: '提前 3 天' },
    { ms: -24 * HOUR, label: '提前 1 天' },
    { ms: -6 * HOUR, label: '提前 6 小时' },
    { ms: -1 * HOUR, label: '提前 1 小时' }
  ];

  function reminders(tasks, now) {
    var out = [];
    tasks.forEach(function (t) {
      if (t.status === 'done') return;
      OFFSETS.forEach(function (o) {
        var at = t.dueAt + o.ms;
        if (at > now - 30 * 60000 && at < now + 14 * DAY) {
          out.push({ task: t, at: at, label: o.label, kind: o.ms === -72 * HOUR ? 'early' : 'near' });
        }
      });
      if (t.dueAt > now - 30 * 60000 && t.dueAt < now + 14 * DAY) {
        out.push({ task: t, at: t.dueAt, label: '截止', kind: 'due' });
      }
    });
    out.sort(function (a, b) { return a.at - b.at; });
    return out;
  }

  /* ---------------- 周负荷 ---------------- */
  function weeklyLoad(tasks, now, settings) {
    var end = now + 7 * DAY;
    var list = tasks.filter(function (t) {
      return t.status !== 'done' && t.dueAt < end;
    });
    var need = list.reduce(function (s, t) { return s + remainingHours(t); }, 0);
    var cap = (settings.dailyHours || 3) * 7;
    var perDay = [];
    for (var i = 0; i < 7; i++) {
      var d0 = U.startOfDay(new Date(now + i * DAY)).getTime();
      var d1 = d0 + DAY;
      var count = tasks.filter(function (t) {
        return t.status !== 'done' && t.dueAt >= d0 && t.dueAt < d1;
      }).length;
      perDay.push(count);
    }
    return {
      need: need, cap: cap, ratio: cap ? need / cap : 0,
      count: list.length, perDay: perDay,
      overload: need > cap * 0.85
    };
  }

  function stats(tasks, now) {
    var open = tasks.filter(function (t) { return t.status !== 'done'; });
    var todayEnd = U.startOfDay(new Date(now)).getTime() + DAY;
    return {
      open: open.length,
      overdue: open.filter(function (t) { return t.dueAt < now; }).length,
      today: open.filter(function (t) { return t.dueAt >= now && t.dueAt < todayEnd; }).length,
      week: open.filter(function (t) { return t.dueAt < now + 7 * DAY; }).length,
      done: tasks.filter(function (t) { return t.status === 'done'; }).length,
      total: tasks.length
    };
  }

  /* ---------------- .ics 导出 ---------------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function icsTime(ts) {
    var d = new Date(ts);
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }
  function icsEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }
  function toIcs(tasks) {
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BuGe//Deadline Radar//CN',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:不鸽 · 作业截止'
    ];
    tasks.filter(function (t) { return t.status !== 'done'; }).forEach(function (t) {
      var p = BG.platformById(t.platform);
      var start = t.dueAt - 30 * 60000;
      lines.push('BEGIN:VEVENT');
      lines.push('UID:buge-' + t.id + '@local');
      lines.push('DTSTAMP:' + icsTime(Date.now()));
      lines.push('DTSTART:' + icsTime(start));
      lines.push('DTEND:' + icsTime(t.dueAt));
      lines.push('SUMMARY:' + icsEscape('【' + p.short + '】' + t.course + ' · ' + t.title));
      lines.push('DESCRIPTION:' + icsEscape('截止 ' + U.fmtDateTime(t.dueAt) + (t.weight ? ' · 占总评 ' + t.weight + '%' : '') + (t.note ? '\n' + t.note : '')));
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-PT6H');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:' + icsEscape('6 小时后截止：' + t.course + ' · ' + t.title));
      lines.push('END:VALARM');
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-P1D');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:' + icsEscape('明天截止：' + t.course + ' · ' + t.title));
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  /* ---------------- 存储 ---------------- */
  var KEY = BG.STORAGE_KEY;
  var memory = null;
  var state = null;

  function defaultSettings(now) {
    return {
      dailyHours: 3,
      semesterStart: BG.semesterStart(now).getTime(),
      notify: false,
      seeded: false
    };
  }

  function normalize(t) {
    return {
      id: t.id, title: t.title || '未命名任务', course: t.course || '未分类', platform: t.platform || 'manual',
      type: t.type || 'homework', dueAt: t.dueAt, weight: t.weight == null ? null : t.weight,
      estHours: t.estHours || 2, progress: t.progress || 0, note: t.note || '',
      status: t.status || 'todo', createdAt: t.createdAt || Date.now(), source: t.source || 'manual'
    };
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      memory = JSON.parse(JSON.stringify(state));
    }
  }

  function load(now) {
    now = now || Date.now();
    var parsed = null;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch (e) { parsed = memory; }

    if (parsed && parsed.tasks && parsed.tasks.length) {
      state = {
        tasks: parsed.tasks.map(normalize),
        settings: Object.assign(defaultSettings(new Date(now)), parsed.settings || {}),
        version: BG.VERSION
      };
    } else {
      state = {
        tasks: BG.seedTasks(new Date(now)).map(normalize),
        settings: defaultSettings(new Date(now)),
        version: BG.VERSION
      };
      state.settings.seeded = true;
      persist();
    }
    return state;
  }

  function get() { return state || load(); }

  function addDrafts(drafts, now) {
    now = now || Date.now();
    var s = get();
    var added = 0, skipped = 0;
    drafts.forEach(function (d) {
      var dup = s.tasks.some(function (t) {
        return t.course === d.course && t.title === d.title &&
          Math.abs(t.dueAt - d.dueAt) < 60 * 60000;
      });
      if (dup) { skipped++; return; }
      s.tasks.push(normalize(Object.assign({}, d, {
        id: 't-' + BG.hash(d.course + d.title + d.dueAt + Math.random()),
        createdAt: now, status: 'todo', progress: 0, source: 'import'
      })));
      added++;
    });
    persist();
    return { added: added, skipped: skipped };
  }

  function update(id, patch) {
    var s = get();
    s.tasks = s.tasks.map(function (t) {
      if (t.id !== id) return t;
      var next = Object.assign({}, t, patch);
      if (patch.status === 'done') next.progress = 100;
      if (patch.progress === 100) next.status = 'done';
      if (patch.status === 'todo' && t.status === 'done' && patch.progress == null) next.progress = 0;
      return normalize(next);
    });
    persist();
  }

  function remove(id) {
    var s = get();
    s.tasks = s.tasks.filter(function (t) { return t.id !== id; });
    persist();
  }

  function setSettings(patch) {
    var s = get();
    s.settings = Object.assign({}, s.settings, patch);
    persist();
  }

  function resetDemo(now) {
    var s = get();
    s.tasks = BG.seedTasks(new Date(now || Date.now())).map(normalize);
    s.settings = defaultSettings(new Date(now || Date.now()));
    persist();
  }

  function clearAll() {
    var s = get();
    s.tasks = [];
    persist();
  }

  BG.model = {
    remainingHours: remainingHours,
    hoursLeft: hoursLeft,
    rawScore: rawScore,
    score: score,
    bucket: bucket,
    reason: reason,
    buildPlan: buildPlan,
    reminders: reminders,
    weeklyLoad: weeklyLoad,
    stats: stats,
    toIcs: toIcs
  };

  BG.store = {
    load: load,
    get: get,
    addDrafts: addDrafts,
    update: update,
    remove: remove,
    setSettings: setSettings,
    resetDemo: resetDemo,
    clearAll: clearAll,
    persist: persist
  };
})(window.BG);
