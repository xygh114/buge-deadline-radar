/* ============================================================
   不鸽 · 音乐（白噪音 / 纯音乐播放器）【最终版】
   - 内置曲目由 Web Audio 实时合成：不联网、不占空间、可循环
   - 也支持导入本地音乐文件（<input type="file">，不离开本机）
   - 只负责声音，不碰页面：UI 通过 BG.music.on(fn) 订阅状态
   ============================================================ */
window.BG = window.BG || {};

(function (BG) {
  'use strict';

  var audioEl = null;
  var ctx = null;
  var master = null;
  var active = [];          /* 正在发声的节点 */
  var listeners = [];
  var imported = [];        /* 本次打开页面导入的本地音乐 */
  var state = {
    playing: false,
    track: null,
    volume: 0.55,
    timerUntil: 0,
    timerId: null,
    timerMinutes: 0,
    error: ''
  };

  function emit() {
    listeners.slice().forEach(function (fn) {
      try { fn(state); } catch (e) { /* ignore */ }
    });
  }

  function ensureCtx() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('这个浏览器不支持 Web Audio');
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = state.volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function ensureAudioEl() {
    if (!audioEl) {
      audioEl = document.getElementById('bgm') || document.createElement('audio');
      audioEl.loop = true;
      audioEl.preload = 'auto';
      audioEl.volume = state.volume;
      audioEl.addEventListener('error', function () {
        state.error = '这首音频打不开，换一首或重新导入';
        state.playing = false;
        emit();
      });
    }
    return audioEl;
  }

  /* ---------- 噪声生成 ---------- */
  function noiseBuffer(seconds, color) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
    for (var i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      if (color === 'pink') {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      } else if (color === 'brown') {
        brown = (brown + 0.02 * white) / 1.02;
        data[i] = brown * 3.5;
      } else {
        data[i] = white * 0.6;
      }
    }
    return buf;
  }

  function noiseLayer(color, filters, level) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(4, color);
    src.loop = true;
    var node = src;
    (filters || []).forEach(function (f) {
      var bq = ctx.createBiquadFilter();
      bq.type = f.type || 'lowpass';
      bq.frequency.value = f.freq;
      bq.Q.value = f.q == null ? 0.7 : f.q;
      node.connect(bq);
      node = bq;
    });
    var gain = ctx.createGain();
    gain.gain.value = level;
    node.connect(gain);
    gain.connect(master);
    src.start();
    active.push({ node: src, gain: gain });
    return gain;
  }

  function slowLfo(gainNode, rate, depth) {
    var lfo = ctx.createOscillator();
    var lfoGain = ctx.createGain();
    lfo.frequency.value = rate;
    lfoGain.gain.value = depth;
    lfo.connect(lfoGain);
    lfoGain.connect(gainNode.gain);
    lfo.start();
    active.push({ node: lfo, gain: lfoGain });
  }

  function pad(freqs, level) {
    freqs.forEach(function (f, i) {
      var o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      o.detune.value = (i - 1.5) * 4;
      var g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.linearRampToValueAtTime(level, ctx.currentTime + 2.8);
      o.connect(g);
      g.connect(master);
      o.start();
      active.push({ node: o, gain: g });
    });
  }

  /* ---------- 五种内置声音 ---------- */
  function startSynth(track) {
    ensureCtx();
    var r = track.recipe;
    if (r === 'rain') {
      noiseLayer('white', [{ type: 'highpass', freq: 420 }, { type: 'lowpass', freq: 7200 }], 0.11);
      noiseLayer('brown', [{ type: 'lowpass', freq: 240 }], 0.05);
    } else if (r === 'pink') {
      noiseLayer('pink', [{ type: 'lowpass', freq: 1600 }], 0.16);
    } else if (r === 'train') {
      noiseLayer('brown', [{ type: 'lowpass', freq: 320 }], 0.18);
      pad([110, 164.81, 220], 0.035);
      slowLfo(active[0].gain, 0.09, 0.05);
    } else if (r === 'cafe') {
      noiseLayer('brown', [{ type: 'lowpass', freq: 900 }], 0.08);
      noiseLayer('white', [{ type: 'highpass', freq: 3000 }, { type: 'lowpass', freq: 9000 }], 0.012);
      pad([261.63, 329.63, 392.0, 493.88], 0.028);
    } else if (r === 'ocean') {
      var g = noiseLayer('brown', [{ type: 'lowpass', freq: 520 }], 0.09);
      slowLfo(g, 0.07, 0.07);
      noiseLayer('white', [{ type: 'highpass', freq: 800 }, { type: 'lowpass', freq: 2500 }], 0.02);
    } else {
      noiseLayer('white', [{ type: 'lowpass', freq: 4000 }], 0.1);
    }
  }

  function stopNodes() {
    active.forEach(function (a) {
      try { a.node.stop(); } catch (e) { /* 已停止 */ }
      try { a.node.disconnect(); } catch (e) { /* ignore */ }
      try { a.gain.disconnect(); } catch (e) { /* ignore */ }
    });
    active = [];
  }

  function stopAudio() {
    if (audioEl) {
      try { audioEl.pause(); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- 对外接口 ---------- */
  function all() {
    return (BG.MUSIC_TRACKS || []).concat(imported);
  }

  function byId(id) {
    return all().filter(function (t) { return t.id === id; })[0] || null;
  }

  function play(track) {
    if (!track) return;
    stopNodes();
    stopAudio();
    state.error = '';
    state.track = track;
    try {
      if (track.type === 'file') {
        var el = ensureAudioEl();
        el.src = track.src;
        el.volume = state.volume;
        el.play().then(function () {
          state.playing = true;
          emit();
        }).catch(function () {
          state.playing = false;
          state.error = '浏览器拦截了播放，点一下播放键再试';
          emit();
        });
        state.playing = true;
      } else {
        startSynth(track);
        state.playing = true;
      }
    } catch (e) {
      state.playing = false;
      state.error = e.message || '播放失败';
    }
    emit();
  }

  function stop() {
    stopNodes();
    stopAudio();
    state.playing = false;
    if (state.timerId) {
      clearTimeout(state.timerId);
      state.timerId = null;
      state.timerUntil = 0;
      state.timerMinutes = 0;
    }
    emit();
  }

  function dismiss() {
    stopNodes();
    stopAudio();
    state.playing = false;
    state.track = null;
    if (state.timerId) {
      clearTimeout(state.timerId);
      state.timerId = null;
      state.timerUntil = 0;
      state.timerMinutes = 0;
    }
    emit();
  }

  function toggle() {
    if (state.playing) stop();
    else play(state.track || all()[0]);
  }

  function setVolume(v) {
    state.volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (master) master.gain.setTargetAtTime(state.volume, ctx.currentTime, 0.05);
    if (audioEl) audioEl.volume = state.volume;
    emit();
  }

  function setTimer(minutes) {
    if (state.timerId) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }
    state.timerUntil = 0;
    state.timerMinutes = 0;
    minutes = Number(minutes) || 0;
    if (minutes > 0) {
      state.timerMinutes = minutes;
      state.timerUntil = Date.now() + minutes * 60000;
      state.timerId = setTimeout(function () {
        state.timerUntil = 0;
        state.timerId = null;
        stop();
      }, minutes * 60000);
    }
    emit();
  }

  function addFile(file) {
    if (!file) return null;
    if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(file.name)) {
      state.error = '请选择音频文件';
      emit();
      return null;
    }
    var track = {
      id: 'local-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      title: file.name.replace(/\.[^.]+$/, ''),
      genre: '本地导入',
      type: 'file',
      src: URL.createObjectURL(file),
      local: true
    };
    imported.push(track);
    emit();
    return track;
  }

  function timerRemaining() {
    return state.timerUntil ? Math.max(0, state.timerUntil - Date.now()) : 0;
  }

  BG.music = {
    all: all,
    byId: byId,
    play: play,
    stop: stop,
    dismiss: dismiss,
    toggle: toggle,
    setVolume: setVolume,
    setTimer: setTimer,
    addFile: addFile,
    timerRemaining: timerRemaining,
    state: function () { return state; },
    on: function (fn) {
      if (typeof fn === 'function') listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (x) { return x !== fn; });
      };
    }
  };
})(window.BG);
