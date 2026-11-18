/* ============================================================
   不鸽 · 交互与渲染
   ============================================================ */
(function (BG) {
  'use strict';

  var U = BG.util, M = BG.model, S = BG.store;
  var DAY = 86400000;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var now = Date.now();
  var ui = { view: 'overview', filter: 'all', sort: 'smart', platform: 'all', drafts: [], editId: null, fired: {} };
  var firstRender = true;

  /* ---------------- 基础 ---------------- */
  function tasks() { return S.get().tasks; }
  function settings() { return S.get().settings; }

  function toast(msg, icon) {
    var el = $('#toast');
    el.innerHTML = '<svg class="ico"><use href="#' + (icon || 'i-check') + '"/></svg><span>' + esc(msg) + '</span>';
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function setView(view) {
    ui.view = view;
    $$('.view').forEach(function (el) {
      el.classList.toggle('is-hidden', el.id !== 'view-' + view);
    });
    $$('.nav-item').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.view === view);
    });
    $('#main').scrollTop = 0;
    render();
  }

  function daysFromNow(ts) {
    var a = U.startOfDay(new Date(now)).getTime();
    var b = U.startOfDay(new Date(ts)).getTime();
    return Math.round((b - a) / DAY);
  }

  /* ---------------- 顶部 ---------------- */
  function renderHeader(list) {
    var d = new Date(now);
    var st = M.stats(list, now);
    var sem = settings().semesterStart;
    var week = BG.teachingWeek(new Date(now), new Date(sem));
    $('#dateLabel').textContent = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' + U.weekLabel(d);
    $('#weekLabel').textContent = '第 ' + week + ' 教学周';

    var hour = d.getHours();
    var greet = hour < 6 ? '凌晨好' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    var headline = '';
    if (!st.open) {
      headline = '清单是空的，<em>0</em> 个截止点在追你';
    } else if (st.overdue > 0) {
      headline = '有 <em>' + st.overdue + '</em> 件事已经逾期了';
    } else if (st.today > 0) {
      headline = '今天有 <em>' + st.today + '</em> 件事要交';
    } else {
      headline = '接下来 7 天还有 <em>' + st.week + '</em> 个截止点';
    }
    $('#headline').innerHTML = greet + '，' + headline;

    var load = M.weeklyLoad(list, now, settings());
    var sub;
    if (!st.open) {
      sub = '没有待办。可以去设置里恢复示例数据，或者导入一段真实的平台通知。';
    } else if (load.overload) {
      sub = '7 天内要投入 ' + load.need.toFixed(1) + ' 小时，按每天 ' + settings().dailyHours +
        ' 小时算有点紧' + (st.overdue ? '，先处理逾期的 ' + st.overdue + ' 件。' : '，今天先清掉一件。');
    } else {
      sub = '7 天内要投入 ' + load.need.toFixed(1) + ' 小时，每天 ' + settings().dailyHours +
        ' 小时的预算还留有余量。' + (st.overdue ? '有 ' + st.overdue + ' 件已逾期，别拖了。' : '');
    }
    $('#headSub').textContent = sub;

    $('#navTaskCount').textContent = st.open;
    $('#tasksMeta').textContent = '共 ' + st.total + ' 件 · 待办 ' + st.open + ' 件 · 已完成 ' + st.done + ' 件';
    $('#listCount').textContent = st.open + ' 件待办';
    $('#listCount2').textContent = st.open + ' 件待办';
  }

  /* ---------------- 雷达 ---------------- */
  function renderRadar(list) {
    var out = [], maxCount = 0, maxIdx = 0;
    for (var i = 0; i < 7; i++) {
      var d = new Date(now + i * DAY);
      var d0 = U.startOfDay(d).getTime(), d1 = d0 + DAY;
      var dayTasks = list.filter(function (t) { return t.dueAt >= d0 && t.dueAt < d1; });
      if (dayTasks.length > maxCount) { maxCount = dayTasks.length; maxIdx = i; }

      var dots = dayTasks.slice(0, 6).map(function (t) {
        var p = BG.platformById(t.platform);
        return '<i class="day-dot' + (t.status === 'done' ? ' is-done' : '') + '" style="--pc:' + p.color +
          '" title="' + esc(t.course + ' · ' + t.title) + '"></i>';
      }).join('');
      if (dayTasks.length > 6) dots += '<i class="day-dot" style="--pc:#B9B2A1"></i>';

      out.push(
        '<div class="day' + (i === 0 ? ' is-today' : '') + (d.getDay() === 0 || d.getDay() === 6 ? ' is-weekend' : '') + '">' +
          '<div class="day-name">' + (i === 0 ? '今天' : U.weekLabel(d)) + '</div>' +
          '<div class="day-num">' + d.getDate() + '</div>' +
          '<div class="day-dots">' + (dots || '<span class="day-empty">—</span>') + '</div>' +
        '</div>'
      );
    }
    $('#radar').innerHTML = out.join('');

    var openCount = list.filter(function (t) { return t.status !== 'done'; }).length;
    var hint;
    if (!openCount) hint = '未来 7 天没有截止点，难得清静。';
    else if (maxCount === 0) hint = '未来 7 天没有新的截止，目前的 ' + openCount + ' 件都在更远处。';
    else {
      var dd = new Date(now + maxIdx * DAY);
      hint = (maxIdx === 0 ? '今天' : U.weekLabel(dd)) + '最挤：<b>' + maxCount + '</b> 个截止点 · 未来 7 天共 <b>' + openCount + '</b> 件待办';
    }
    $('#radarHint').innerHTML = hint;
  }

  /* ---------------- Hero ---------------- */
  function renderHero(list) {
    var open = list.filter(function (t) { return t.status !== 'done'; })
      .sort(function (a, b) { return M.rawScore(b, now) - M.rawScore(a, now); });
    var wrap = $('#hero');

    if (!open.length) {
      wrap.innerHTML =
        '<section class="hero is-empty">' +
          '<div class="hero-left">' +
            '<div class="kicker lime">现在最该做的一件事</div>' +
            '<h2>没有待办。这个晚上归你。</h2>' +
            '<p class="hero-reason">导入一段平台通知，或者恢复示例数据看看它怎么工作。</p>' +
            '<div class="hero-actions">' +
              '<button class="btn btn-lime" data-action="open-import">导入一条通知</button>' +
              '<button class="btn btn-dark-ghost" data-action="seed-demo">恢复示例</button>' +
            '</div>' +
          '</div>' +
          '<div class="hero-empty-mark"><svg class="ico" style="width:24px;height:24px"><use href="#i-check"/></svg></div>' +
        '</section>';
      return;
    }

    var t = open[0];
    var p = BG.platformById(t.platform);
    var score = M.score(t, now);
    var rem = M.remainingHours(t);
    var C = 326.73;
    var off = C * (1 - score / 100);
    var hot = (t.dueAt - now) < 24 * 3600000;

    wrap.innerHTML =
      '<section class="hero">' +
        '<div class="hero-left">' +
          '<div class="kicker lime">现在最该做的一件事</div>' +
          '<h2><span class="hero-course">' + esc(t.course) + ' · </span>' + esc(t.title) + '</h2>' +
          '<p class="hero-reason">' + esc(M.reason(t, now)) + '</p>' +
          '<div class="hero-tags">' +
            '<span class="hero-tag hot">' + esc(U.countdown(t.dueAt - now)) + '</span>' +
            (t.weight ? '<span class="hero-tag">占总评 ' + t.weight + '%</span>' : '') +
            '<span class="hero-tag">还需 ' + U.humanHours(rem) + '</span>' +
            '<span class="hero-tag">' + esc(p.name) + '</span>' +
          '</div>' +
          '<div class="hero-actions">' +
            '<button class="btn btn-lime" data-action="focus" data-id="' + t.id + '">开始做</button>' +
            '<button class="btn btn-dark-ghost" data-action="toggle" data-id="' + t.id + '">标记完成</button>' +
          '</div>' +
        '</div>' +
        '<div class="hero-ring">' +
          '<svg viewBox="0 0 120 120">' +
            '<circle class="ring-track" cx="60" cy="60" r="52"></circle>' +
            '<circle class="ring-fill" cx="60" cy="60" r="52" stroke-dasharray="' + C + '" stroke-dashoffset="' + off.toFixed(1) + '"></circle>' +
          '</svg>' +
          '<div class="ring-num">' + score + '</div>' +
          '<div class="ring-label">紧迫度</div>' +
        '</div>' +
      '</section>';
  }

  /* ---------------- 筛选 ---------------- */
  function filterTasks(list) {
    var out = list.slice();
    if (ui.platform !== 'all') out = out.filter(function (t) { return t.platform === ui.platform; });
    if (ui.filter === 'week') out = out.filter(function (t) { return t.status !== 'done' && t.dueAt < now + 7 * DAY; });
    else if (ui.filter === 'overdue') out = out.filter(function (t) { return t.status !== 'done' && t.dueAt < now; });
    else if (ui.filter === 'done') out = out.filter(function (t) { return t.status === 'done'; });

    if (ui.sort === 'due') out.sort(function (a, b) { return a.dueAt - b.dueAt; });
    else if (ui.sort === 'weight') out.sort(function (a, b) { return (b.weight || 0) - (a.weight || 0); });
    else out.sort(function (a, b) {
      if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
      return M.rawScore(b, now) - M.rawScore(a, now);
    });
    return out;
  }

  function renderFilters(list) {
    var open = list.filter(function (t) { return t.status !== 'done'; });
    var defs = [
      { id: 'all', label: '全部', n: open.length },
      { id: 'week', label: '7 天内', n: open.filter(function (t) { return t.dueAt < now + 7 * DAY; }).length },
      { id: 'overdue', label: '已逾期', n: open.filter(function (t) { return t.dueAt < now; }).length },
      { id: 'done', label: '已完成', n: list.filter(function (t) { return t.status === 'done'; }).length }
    ];
    var html = defs.map(function (d) {
      return '<button class="chip' + (ui.filter === d.id ? ' is-active' : '') + '" data-action="filter" data-filter="' +
        d.id + '" role="tab" aria-selected="' + (ui.filter === d.id) + '">' + d.label +
        '<span class="n">' + d.n + '</span></button>';
    }).join('');
    if (ui.platform !== 'all') {
      var p = BG.platformById(ui.platform);
      html = '<button class="chip is-active" data-action="clear-platform">' + esc(p.short) + ' ×</button>' + html;
    }
    $('#filters').innerHTML = html;
    $('#filters2').innerHTML = html;

    $$('#sortSel, #sortSel2').forEach(function (sel) { sel.value = ui.sort; });
  }

  /* ---------------- 任务卡 ---------------- */
  var GROUP_LABEL = {
    overdue: '已逾期', critical: '24 小时内', soon: '3 天内', week: '本周内', later: '更远', done: '已完成'
  };

  function taskCard(t) {
    var p = BG.platformById(t.platform);
    var b = M.bucket(t, now);
    var cd = t.status === 'done' ? '已完成' : U.countdown(t.dueAt - now);
    var cls = b === 'overdue' || b === 'critical' ? 'hot' : b === 'soon' ? 'warm' : 'cool';
    var score = M.score(t, now);
    var progress = Math.max(0, Math.min(100, t.progress || 0));

    return '<article class="task' + (t.status === 'done' ? ' is-done' : '') + '" data-id="' + t.id + '" data-bucket="' + b + '">' +
      '<button class="check" data-action="toggle" data-id="' + t.id + '" aria-label="' + (t.status === 'done' ? '标记未完成' : '标记完成') + '">' +
        '<svg class="ico"><use href="#i-check"/></svg></button>' +
      '<div class="task-body">' +
        '<div class="task-top">' +
          '<span class="plat" style="--pc:' + p.color + ';--pb:' + p.bg + '">' + esc(p.short) + '</span>' +
          '<span class="course">' + esc(t.course) + '</span>' +
          '<span class="type">' + esc(BG.typeById(t.type).name) + '</span>' +
        '</div>' +
        '<h3 class="task-title">' + esc(t.title) + '</h3>' +
        '<div class="task-meta">' +
          '<span class="mi"><svg class="ico"><use href="#i-clock"/></svg>' + esc(U.fmtMonthDay(t.dueAt) + ' ' + U.fmtTime(t.dueAt)) + '</span>' +
          (t.weight ? '<span class="mi">占总评 ' + t.weight + '%</span>' : '') +
          '<span class="mi">预估 ' + U.humanHours(t.estHours) + '</span>' +
          (progress > 0 ? '<span class="mi">已完成 ' + progress + '%</span>' : '') +
        '</div>' +
        (progress > 0 || t.status === 'done' ? '<div class="bar"><i style="width:' + (t.status === 'done' ? 100 : progress) + '%"></i></div>' : '') +
      '</div>' +
      '<div class="task-right">' +
        '<div class="cd ' + cls + '">' + esc(cd) + '</div>' +
        '<div class="pri">优先级 <b>' + score + '</b></div>' +
        '<div class="row-actions">' +
          '<button class="icon-btn" data-action="edit" data-id="' + t.id + '" title="编辑" aria-label="编辑">' +
            '<svg class="ico"><use href="#i-edit"/></svg></button>' +
          '<button class="icon-btn" data-action="delete" data-id="' + t.id + '" title="删除" aria-label="删除">' +
            '<svg class="ico"><use href="#i-trash"/></svg></button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function renderList(list) {
    var filtered = filterTasks(list);
    var el1 = $('#taskList'), el2 = $('#taskList2');
    if (!filtered.length) {
      var empty = '<div class="empty"><b>这里还没有任务</b><p>把群里的通知、平台公告粘进“导入通知”，它会自动拆成条目。</p></div>';
      el1.innerHTML = empty; el2.innerHTML = empty;
      return;
    }
    var html = '';
    ['overdue', 'critical', 'soon', 'week', 'later', 'done'].forEach(function (g) {
      var items = filtered.filter(function (t) { return M.bucket(t, now) === g; });
      if (!items.length) return;
      var color = g === 'overdue' ? 'var(--red)' : g === 'critical' ? '#D2691E' : g === 'soon' ? '#C9A227' : g === 'done' ? '#BFD8C9' : '#C9C2B1';
      html += '<div class="group">' +
        '<div class="group-head"><i class="g-dot" style="--gc:' + color + '"></i>' + GROUP_LABEL[g] +
        '<span class="g-n">' + items.length + '</span><span class="g-line"></span></div>' +
        items.map(taskCard).join('') +
        '</div>';
    });
    el1.innerHTML = html;
    el2.innerHTML = html;
  }

  /* ---------------- 右栏 ---------------- */
  function renderPlan(list) {
    var plan = M.buildPlan(list, now, settings());
    $('#budgetTag').textContent = settings().dailyHours + 'h 预算';
    var el = $('#plan');

    if (plan.late) {
      el.innerHTML = '<p class="plan-empty">已经 23:00 了。今天先睡，明天 8:30 从这里继续排。</p>' +
        '<div class="plan-foot">明天可用 <b>' + settings().dailyHours + '</b> 小时，共 <b>' + plan.totalNeeded.toFixed(1) + '</b> 小时待办。</div>';
      return;
    }
    if (!plan.blocks.length) {
      el.innerHTML = '<p class="plan-empty">没有待办，今天不用排计划。</p>';
      return;
    }
    var html = plan.blocks.map(function (b) {
      var t = list.filter(function (x) { return x.id === b.taskId; })[0];
      if (!t) return '';
      var p = BG.platformById(t.platform);
      return '<div class="plan-item">' +
        '<div class="plan-time">' + U.fmtTime(b.start.getTime()) + '</div>' +
        '<div class="plan-axis"><i style="--pc:' + p.color + '"></i></div>' +
        '<div class="plan-body">' +
          '<div class="plan-course">' + esc(t.course) + '</div>' +
          '<div class="plan-title">' + esc(t.title) + '</div>' +
          '<div class="plan-dur">' + U.fmtTime(b.start.getTime()) + '–' + U.fmtTime(b.end.getTime()) + ' · ' + Math.round(b.hours * 60) + ' 分钟</div>' +
        '</div>' +
      '</div>';
    }).join('');

    html += '<div class="plan-foot">今天排 <b>' + plan.scheduledHours.toFixed(1) + '</b> / ' + plan.budget + ' 小时' +
      (plan.overflow > 0.1 ? ' · <span class="warn">还有 ' + plan.overflow.toFixed(1) + ' 小时留给之后几天</span>' : '') + '</div>';
    el.innerHTML = html;
  }

  function reminderTime(ts) {
    var d = daysFromNow(ts);
    if (d === 0) return '今天 ' + U.fmtTime(ts);
    if (d === 1) return '明天 ' + U.fmtTime(ts);
    return U.fmtMonthDay(ts) + ' ' + U.fmtTime(ts);
  }

  function renderReminders(list) {
    var rem = M.reminders(list, now).slice(0, 6);
    var el = $('#reminders');
    if (!rem.length) {
      el.innerHTML = '<p class="plan-empty">未来 14 天没有提醒节点。</p>';
      return;
    }
    el.innerHTML = rem.map(function (r) {
      var isDue = r.label === '截止';
      return '<div class="rem">' +
        '<div class="rem-time' + (r.at - now < 3600000 ? ' now' : '') + '">' + reminderTime(r.at) + '</div>' +
        '<div class="rem-body"><span class="rem-task">' + esc(r.task.course) + ' · ' + esc(r.task.title) + '</span>' +
        '<span class="rem-label' + (isDue ? ' due' : '') + '">' + r.label + '</span></div>' +
      '</div>';
    }).join('');
  }

  function renderLoad(list) {
    var load = M.weeklyLoad(list, now, settings());
    var pct = Math.min(100, Math.round(load.ratio * 100));
    $('#loadRatio').textContent = pct + '%';
    var max = Math.max.apply(null, load.perDay.concat([1]));
    var days = load.perDay.map(function (n, i) {
      var d = new Date(now + i * DAY);
      var h = n ? Math.max(6, (n / max) * 30) : 2;
      var cls = n ? (i === 0 ? 'today' : 'has') : '';
      return '<div class="load-day"><i class="' + cls + '" style="height:' + h + 'px" title="' + (n || 0) + ' 件"></i>' +
        '<span>' + U.weekLabel(d).replace('周', '') + '</span></div>';
    }).join('');

    $('#load').innerHTML =
      '<div class="load-num"><b>' + load.need.toFixed(1) + '</b><span>/ ' + load.cap + ' 小时</span></div>' +
      '<div class="load-bar"><i class="' + (load.overload ? 'over' : '') + '" style="width:' + pct + '%"></i></div>' +
      '<div class="load-days">' + days + '</div>' +
      '<p class="load-note' + (load.overload ? ' warn' : '') + '">' +
        (load.overload
          ? '按每天 ' + settings().dailyHours + ' 小时算，这周排不满，建议挑一件提前做。'
          : '还剩 ' + Math.max(0, load.cap - load.need).toFixed(1) + ' 小时余量，节奏正常。') +
      '</p>';
  }

  function renderPlatformNav(list) {
    var open = list.filter(function (t) { return t.status !== 'done'; });
    var html = '<button class="pf-item' + (ui.platform === 'all' ? ' is-active' : '') + '" data-action="platform" data-platform="all">' +
      '<i class="pf-dot" style="--pc:#D9F26B"></i><span>全部平台</span><span class="pf-count">' + open.length + '</span></button>';
    BG.PLATFORMS.forEach(function (p) {
      if (p.id === 'manual') return;
      var n = open.filter(function (t) { return t.platform === p.id; }).length;
      if (!n && ui.platform !== p.id) return;
      html += '<button class="pf-item' + (ui.platform === p.id ? ' is-active' : '') + '" data-action="platform" data-platform="' + p.id + '">' +
        '<i class="pf-dot" style="--pc:' + p.color + '"></i><span>' + esc(p.short) + '</span><span class="pf-count">' + n + '</span></button>';
    });
    $('#platformNav').innerHTML = html;
  }

  /* ---------------- 设置页 ---------------- */
  function renderSettings(list) {
    if (ui.view !== 'settings') return;
    var st = settings();
    var range = $('#dailyHours');
    if (document.activeElement !== range) range.value = st.dailyHours;
    $('#dailyHoursOut').textContent = st.dailyHours + ' 小时';

    var dateInput = $('#semStart');
    if (document.activeElement !== dateInput) {
      var d = new Date(st.semesterStart);
      dateInput.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    $('#weekNow').textContent = '现在是第 ' + BG.teachingWeek(new Date(now), new Date(st.semesterStart)) + ' 周';

    var nb = $('#notifyBtn');
    var on = st.notify && ('Notification' in window) && Notification.permission === 'granted';
    nb.innerHTML = '<svg class="ico"><use href="#i-bell"/></svg><span>' + (on ? '桌面提醒已开启' : '开启桌面提醒') + '</span>';
    nb.style.color = on ? 'var(--green)' : '';
    $('#notifyMini').textContent = on ? '已开启' : '开启';

    var rem = M.reminders(list, now).slice(0, 5);
    $('#reminderPreview').innerHTML = rem.length
      ? rem.map(function (r) {
          return '<div class="rp-item"><span>' + esc(r.task.title) + '</span><b>' + reminderTime(r.at) + '</b></div>';
        }).join('')
      : '<div class="rp-item"><span>暂无</span><b>—</b></div>';
    $('#verLabel').textContent = 'v' + BG.VERSION;
  }

  /* ---------------- 总渲染 ---------------- */
  function render() {
    now = Date.now();
    var list = tasks();
    renderHeader(list);
    renderRadar(list);
    renderHero(list);
    renderFilters(list);
    renderList(list);
    renderPlatformNav(list);
    renderPlan(list);
    renderReminders(list);
    renderLoad(list);
    renderSettings(list);
    if (firstRender) {
      document.body.classList.add('is-ready');
      firstRender = false;
    }
  }

  /* ---------------- 导入弹层 ---------------- */
  function openImport() {
    $('#modalRoot').innerHTML =
      '<div class="modal-mask">' +
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">' +
          '<header class="modal-head">' +
            '<div>' +
              '<div class="kicker">导入 · 粘贴原文即可</div>' +
              '<h2 id="modalTitle">把通知粘进来</h2>' +
              '<p>课程名、截止时间、平台、占总评比例会被自动拆出来。识别不准的地方，你可以直接改。</p>' +
            '</div>' +
            '<button class="icon-btn" data-action="close-modal" aria-label="关闭"><svg class="ico"><use href="#i-close"/></svg></button>' +
          '</header>' +
          '<div class="modal-body">' +
            '<textarea id="noticeInput" class="notice-input" placeholder="例如：&#10;【高等数学A(上)】第11周作业已发布&#10;请于 11月20日 23:59 前在中国大学MOOC提交，占总评 10%。"></textarea>' +
            '<div class="notice-tools">' +
              '<button class="link-btn" data-action="fill-sample">填入一段示例通知</button>' +
              '<span class="char-count" id="charCount">0 字</span>' +
            '</div>' +
            '<div id="parseResult"></div>' +
          '</div>' +
          '<footer class="modal-foot">' +
            '<span class="foot-note">不会联网，文本只在本机解析。</span>' +
            '<div class="btn-row-end">' +
              '<button class="btn btn-ghost" data-action="close-modal">取消</button>' +
              '<button class="btn btn-dark" data-action="parse" id="parseBtn">识别一下</button>' +
              '<button class="btn btn-lime is-hidden" data-action="import-confirm" id="importBtn">导入</button>' +
            '</div>' +
          '</footer>' +
        '</div>' +
      '</div>';

    var ta = $('#noticeInput');
    ta.addEventListener('input', function () {
      $('#charCount').textContent = ta.value.length + ' 字';
    });
    ta.focus();
    ui.drafts = [];
  }

  function confidenceDots(c) {
    if (!c) return '';
    var order = ['due', 'course', 'platform', 'weight'];
    var cls = { high: 'ok', med: 'med', none: '' };
    return '<span class="conf" title="截止/课程/平台/占比 的识别把握">' +
      order.map(function (k) { return '<i class="' + (cls[c[k]] || '') + '"></i>'; }).join('') + '</span>';
  }

  function draftRow(d, i) {
    var p = BG.platformById(d.platform);
    return '<article class="draft" data-index="' + i + '">' +
      '<div class="draft-top">' +
        '<span class="draft-idx">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<input class="draft-course" data-field="course" value="' + esc(d.course) + '" placeholder="课程名" aria-label="课程">' +
        confidenceDots(d.confidence) +
        '<button class="icon-btn" data-action="drop-draft" data-index="' + i + '" aria-label="移除这条">' +
          '<svg class="ico"><use href="#i-close"/></svg></button>' +
      '</div>' +
      '<input class="draft-title" data-field="title" value="' + esc(d.title) + '" placeholder="任务名" aria-label="任务名">' +
      '<div class="draft-fields">' +
        '<label>截止时间<input type="datetime-local" data-field="dueAt" value="' + U.toLocalInput(d.dueAt) + '"></label>' +
        '<label>占总评 %<input type="number" min="0" max="100" data-field="weight" value="' + (d.weight == null ? '' : d.weight) + '" placeholder="—"></label>' +
        '<label>预计小时<input type="number" min="0" step="0.5" data-field="estHours" value="' + d.estHours + '"></label>' +
        '<label>平台<select data-field="platform">' +
          BG.PLATFORMS.map(function (pl) {
            return '<option value="' + pl.id + '"' + (pl.id === d.platform ? ' selected' : '') + '>' + esc(pl.name) + '</option>';
          }).join('') +
        '</select></label>' +
      '</div>' +
      '<div class="draft-raw">原文：' + esc((d.raw || '').replace(/\s+/g, ' ')) + '</div>' +
    '</article>';
  }

  function renderPreview(res) {
    var el = $('#parseResult');
    if (!res) { el.innerHTML = ''; return; }
    var btn = $('#importBtn');
    if (btn) {
      btn.classList.toggle('is-hidden', !ui.drafts.length);
      btn.textContent = '导入 ' + ui.drafts.length + ' 条';
    }
    var head = '<div class="parse-summary"><svg class="ico sm"><use href="#i-spark"/></svg>' +
      '识别到 <b>' + ui.drafts.length + '</b> 条 · 原文 <b>' + res.blockCount + '</b> 段' +
      (res.failed.length ? ' · <span style="color:var(--amber)">' + res.failed.length + ' 段没找到截止时间</span>' : '') +
      '</div>';
    var fail = res.failed.length
      ? '<div class="fail-note">这些段落没识别出时间，可以手动补一条：<br>' +
        res.failed.map(function (f) { return '· ' + esc(f.text) + '…'; }).join('<br>') + '</div>'
      : '';
    el.innerHTML = head + fail + (ui.drafts.length
      ? '<div class="drafts">' + ui.drafts.map(draftRow).join('') + '</div>'
      : '<div class="empty" style="padding:26px"><b>还没识别到内容</b><p>粘贴通知后点“识别一下”，或者先点“填入一段示例通知”。</p></div>');
  }

  function doParse() {
    var text = ($('#noticeInput') || {}).value || '';
    if (!text.trim()) { toast('先粘贴一段通知'); return; }
    var res = BG.parseNotices(text, { now: Date.now(), semStart: settings().semesterStart });
    ui.drafts = res.drafts.map(function (d) { return Object.assign({}, d); });
    renderPreview(res);
    if (!res.drafts.length) toast('没找到截止时间，试试把“11月20日 23:59”这样的写法带上', 'i-warn');
  }

  function confirmImport() {
    var valid = ui.drafts.filter(function (d) { return d.dueAt && d.title; });
    if (!valid.length) { toast('还没有可导入的任务'); return; }
    var r = S.addDrafts(valid, Date.now());
    closeModal();
    render();
    toast('已加入 ' + r.added + ' 个截止点' + (r.skipped ? '，' + r.skipped + ' 条重复已跳过' : ''));
  }

  /* ---------------- 任务表单 ---------------- */
  function openTaskForm(task) {
    var isEdit = !!task;
    var t = task || {
      id: null, title: '', course: '', platform: 'manual', type: 'homework',
      dueAt: U.addDays(U.startOfDay(new Date()), 1).getTime() + 23.9 * 3600000,
      weight: null, estHours: 2, progress: 0, note: ''
    };
    if (!task) t.dueAt = new Date(new Date().setHours(23, 59, 0, 0)).getTime() + DAY;

    $('#modalRoot').innerHTML =
      '<div class="modal-mask">' +
        '<div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="modalTitle">' +
          '<header class="modal-head">' +
            '<div>' +
              '<div class="kicker">' + (isEdit ? '编辑任务' : '手动添加') + '</div>' +
              '<h2 id="modalTitle">' + (isEdit ? esc(t.course) + ' · ' + esc(t.title) : '补一条系统里没有的截止时间') + '</h2>' +
              '<p>手动填写适合“老师口头布置”或者通知太短、拆不出来的情况。</p>' +
            '</div>' +
            '<button class="icon-btn" data-action="close-modal" aria-label="关闭"><svg class="ico"><use href="#i-close"/></svg></button>' +
          '</header>' +
          '<div class="modal-body">' +
            '<div class="form">' +
              '<div class="field full"><label for="fTitle">任务名</label>' +
                '<input id="fTitle" class="input" value="' + esc(t.title) + '" placeholder="例如：第 11 周作业"></div>' +
              '<div class="field"><label for="fCourse">课程</label>' +
                '<input id="fCourse" class="input" value="' + esc(t.course) + '" placeholder="例如：高等数学A(上)"></div>' +
              '<div class="field"><label for="fPlatform">来源平台</label>' +
                '<select id="fPlatform" class="input">' + BG.PLATFORMS.map(function (p) {
                  return '<option value="' + p.id + '"' + (p.id === t.platform ? ' selected' : '') + '>' + esc(p.name) + '</option>';
                }).join('') + '</select></div>' +
              '<div class="field"><label for="fDue">截止时间</label>' +
                '<input id="fDue" class="input" type="datetime-local" value="' + U.toLocalInput(t.dueAt) + '"></div>' +
              '<div class="field"><label for="fType">类型</label>' +
                '<select id="fType" class="input">' + BG.TYPES.map(function (ty) {
                  return '<option value="' + ty.id + '"' + (ty.id === t.type ? ' selected' : '') + '>' + esc(ty.name) + '</option>';
                }).join('') + '</select></div>' +
              '<div class="field"><label for="fWeight">占总评 %（可空）</label>' +
                '<input id="fWeight" class="input" type="number" min="0" max="100" value="' + (t.weight == null ? '' : t.weight) + '" placeholder="例如 30"></div>' +
              '<div class="field"><label for="fHours">预计投入小时</label>' +
                '<input id="fHours" class="input" type="number" min="0" step="0.5" value="' + t.estHours + '"></div>' +
              '<div class="field full"><label for="fNote">备注</label>' +
                '<textarea id="fNote" class="input" placeholder="提交方式、格式要求、组队信息……">' + esc(t.note) + '</textarea></div>' +
              (isEdit ? '<div class="field full"><label>完成进度</label>' +
                '<div class="progress-row"><input id="fProgress" type="range" class="range" min="0" max="100" step="5" value="' + (t.progress || 0) + '">' +
                '<b id="fProgressOut">' + (t.progress || 0) + '%</b></div></div>' : '') +
            '</div>' +
          '</div>' +
          '<footer class="modal-foot">' +
            (isEdit ? '<button class="link-btn" data-action="delete" data-id="' + t.id + '">删除这条任务</button>' : '<span class="foot-note">保存后会立刻进入优先级排序。</span>') +
            '<div class="btn-row-end">' +
              '<button class="btn btn-ghost" data-action="close-modal">取消</button>' +
              '<button class="btn btn-dark" data-action="save-task" data-id="' + (t.id || '') + '">保存</button>' +
            '</div>' +
          '</footer>' +
        '</div>' +
      '</div>';

    var pr = $('#fProgress');
    if (pr) pr.addEventListener('input', function () { $('#fProgressOut').textContent = pr.value + '%'; });
    setTimeout(function () { $('#fTitle').focus(); }, 50);
  }

  function saveTask(id) {
    var title = $('#fTitle').value.trim();
    var course = $('#fCourse').value.trim() || '未分类';
    var due = U.fromLocalInput($('#fDue').value);
    if (!title) { toast('任务名不能为空', 'i-warn'); $('#fTitle').focus(); return; }
    if (!due) { toast('请选择截止时间', 'i-warn'); $('#fDue').focus(); return; }

    var patch = {
      title: title, course: course, platform: $('#fPlatform').value, type: $('#fType').value,
      dueAt: due, weight: $('#fWeight').value === '' ? null : Number($('#fWeight').value),
      estHours: Number($('#fHours').value) || 2, note: $('#fNote').value.trim()
    };
    if ($('#fProgress')) patch.progress = Number($('#fProgress').value);

    if (id) {
      S.update(id, patch);
      toast('已更新');
    } else {
      S.addDrafts([Object.assign({ confidence: {} }, patch)], Date.now());
      toast('已添加一条截止时间');
    }
    closeModal();
    render();
  }

  function closeModal() {
    $('#modalRoot').innerHTML = '';
  }

  function confirmDialog(title, text, okLabel, onOk) {
    $('#modalRoot').innerHTML =
      '<div class="modal-mask">' +
        '<div class="modal" style="width:min(420px,100%)" role="dialog" aria-modal="true">' +
          '<header class="modal-head"><div><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p></div></header>' +
          '<footer class="modal-foot"><span></span><div class="btn-row-end">' +
            '<button class="btn btn-ghost" data-action="close-modal">取消</button>' +
            '<button class="btn btn-danger-ghost" data-action="confirm-ok">' + esc(okLabel) + '</button>' +
          '</div></footer>' +
        '</div>' +
      '</div>';
    $('#modalRoot').querySelector('[data-action="confirm-ok"]').addEventListener('click', function () {
      closeModal(); onOk();
    });
  }

  /* ---------------- 提醒 ---------------- */
  function enableNotify() {
    if (!('Notification' in window)) { toast('这个浏览器不支持桌面通知', 'i-warn'); return; }
    if (Notification.permission === 'granted') {
      S.setSettings({ notify: true });
      toast('桌面提醒已开启，页面开着时会在节点弹出');
      render();
      return;
    }
    Notification.requestPermission().then(function (perm) {
      if (perm === 'granted') {
        S.setSettings({ notify: true });
        toast('桌面提醒已开启');
        render();
      } else {
        toast('通知权限被拒绝，可以在浏览器站点设置里重新允许', 'i-warn');
      }
    }).catch(function () { toast('这个环境不支持通知权限', 'i-warn'); });
  }

  function checkNotifications() {
    var st = settings();
    if (!st.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    M.reminders(tasks(), Date.now()).forEach(function (r) {
      var key = r.task.id + '|' + r.label;
      if (ui.fired[key]) return;
      if (r.at <= Date.now() && r.at > Date.now() - 2 * 60000) {
        ui.fired[key] = true;
        var body = r.label === '截止'
          ? '现在截止：' + r.task.course + ' · ' + r.task.title
          : r.label + '：' + r.task.course + ' · ' + r.task.title;
        try { new Notification('不鸽 · ' + U.fmtTime(r.task.dueAt) + ' 截止', { body: body }); } catch (e) { /* ignore */ }
        toast(body, 'i-bell');
      }
    });
  }

  /* ---------------- 导出 ---------------- */
  function exportIcs() {
    var ics = M.toIcs(tasks());
    var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '不鸽-作业截止.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('已导出 .ics，可导入手机自带日历');
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('click', function (e) {
    var mask = e.target.classList && e.target.classList.contains('modal-mask');
    var trigger = e.target.closest('[data-action]');

    if (mask) { closeModal(); return; }
    if (!trigger) return;

    var action = trigger.dataset.action;
    var id = trigger.dataset.id;

    switch (action) {
      case 'view': setView(trigger.dataset.view); break;
      case 'filter': ui.filter = trigger.dataset.filter; render(); break;
      case 'platform':
        ui.platform = trigger.dataset.platform;
        if (ui.view === 'overview') setView('tasks'); else render();
        break;
      case 'clear-platform': ui.platform = 'all'; render(); break;
      case 'open-import': openImport(); break;
      case 'open-manual': openTaskForm(null); break;
      case 'close-modal': closeModal(); break;
      case 'fill-sample':
        $('#noticeInput').value = BG.SAMPLE_NOTICE;
        $('#charCount').textContent = $('#noticeInput').value.length + ' 字';
        doParse();
        break;
      case 'parse': doParse(); break;
      case 'import-confirm': confirmImport(); break;
      case 'drop-draft': {
        var idx = Number(trigger.dataset.index);
        ui.drafts.splice(idx, 1);
        renderPreview({ blockCount: ui.drafts.length + 1, failed: [] });
        break;
      }
      case 'save-task': saveTask(id); break;
      case 'toggle': {
        var t = tasks().filter(function (x) { return x.id === id; })[0];
        if (!t) break;
        var done = t.status !== 'done';
        S.update(id, { status: done ? 'done' : 'todo', progress: done ? 100 : 0 });
        render();
        toast(done ? '完成 · 还剩 ' + M.stats(tasks(), now).open + ' 件待办' : '已放回待办');
        break;
      }
      case 'edit': {
        var t2 = tasks().filter(function (x) { return x.id === id; })[0];
        if (t2) openTaskForm(t2);
        break;
      }
      case 'delete':
        confirmDialog('删除这条任务？', '删除后无法恢复，导出的日历也不会再包含它。', '删除', function () {
          S.remove(id);
          closeModal();
          render();
          toast('已删除');
        });
        break;
      case 'focus': {
        var el = document.querySelector('.task[data-id="' + id + '"]');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('is-flash');
          setTimeout(function () { el.classList.remove('is-flash'); }, 1400);
        }
        toast('先把最小的那一步做了：打开资料，写下第一行');
        break;
      }
      case 'export-ics': exportIcs(); break;
      case 'notify': enableNotify(); break;
      case 'seed-demo':
        S.resetDemo(Date.now());
        closeModal();
        render();
        toast('已恢复示例数据');
        break;
      case 'clear-all':
        confirmDialog('清空全部任务？', '这会删掉本机保存的所有任务，重新载入示例可以恢复演示数据。', '清空', function () {
          S.clearAll();
          closeModal();
          render();
          toast('已清空');
        });
        break;
    }
  });

  document.addEventListener('input', function (e) {
    var field = e.target.dataset.field;
    if (!field) return;
    var card = e.target.closest('.draft');
    if (!card) return;
    var idx = Number(card.dataset.index);
    var d = ui.drafts[idx];
    if (!d) return;
    if (field === 'dueAt') d.dueAt = U.fromLocalInput(e.target.value);
    else if (field === 'weight') d.weight = e.target.value === '' ? null : Number(e.target.value);
    else if (field === 'estHours') d.estHours = Number(e.target.value) || 0;
    else d[field] = e.target.value;
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'sortSel' || e.target.id === 'sortSel2') {
      ui.sort = e.target.value;
      render();
    }
    if (e.target.id === 'semStart' && e.target.value) {
      var d = new Date(e.target.value + 'T00:00:00');
      S.setSettings({ semesterStart: d.getTime() });
      render();
    }
    if (e.target.id === 'dailyHours') {
      S.setSettings({ dailyHours: Number(e.target.value) });
      render();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('#modalRoot').innerHTML) closeModal();
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openImport(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && $('#noticeInput')) doParse();
  });

  /* ---------------- 初始化 ---------------- */
  function init() {
    S.load(Date.now());
    var list = tasks();
    /* 演示入口：file:// 下也能直接打开某个状态给评委看 */
    var params = new URLSearchParams(location.search);
    var state = params.get('state');

    render();
    setView(params.get('view') === 'settings' ? 'settings' : 'overview');

    if (state === 'import') {
      openImport();
      $('#noticeInput').value = BG.SAMPLE_NOTICE;
      $('#charCount').textContent = BG.SAMPLE_NOTICE.length + ' 字';
      doParse();
    }
    if (state === 'manual') openTaskForm(null);
    if (state === 'settings') setView('settings');
    if (state === 'tasks') setView('tasks');
    if (state === 'empty') {
      S.clearAll();
      render();
      toast('示例数据已清空，可以自己导入一条');
    }

    setInterval(checkNotifications, 30000);
    setInterval(function () {
      if (document.hidden) return;
      if ($('#modalRoot').innerHTML) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
      render();
    }, 120000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.BG);
