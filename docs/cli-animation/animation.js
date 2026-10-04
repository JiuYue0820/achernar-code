'use strict';
// Achernar Code · 60s promo. Every frame is a pure function of `t` (ms), so
// scrubbing, looping and frame-by-frame export always produce identical images.
(() => {
  const DURATION = 60000;
  const SEED = 20260927;

  // ---------- helpers ----------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  const seg = (t, a, b, ease = easeInOut) => ease(clamp((t - a) / (b - a)));
  const fade = (t, a, b, c, d) => Math.min(seg(t, a, b), 1 - seg(t, c, d));
  const typed = (text, t, start, cps = 26) => text.slice(0, Math.max(0, Math.floor(((t - start) / 1000) * cps)));
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const caret = (t) => (Math.floor(t / 530) % 2 ? '' : '<i class="caret"></i>');
  const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  const spin = (t) => SPIN[Math.floor(t / 80) % SPIN.length];
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let r = Math.imul(a ^ (a >>> 15), 1 | a);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (x, y) => {
    let h = Math.imul(x * 374761393 + y * 668265263 + SEED, 1274126177);
    h ^= h >>> 13;
    return ((Math.imul(h, 1103515245) >>> 0) % 10000) / 10000;
  };

  // ---------- storyboard (导演分镜) ----------
  const SHOTS = [
    { at: 0, n: '01', t: '一颗恒星，一个终端', d: 'Achernar Code — 专注编程的 CLI' },
    { at: 10000, n: '02', t: '输入 achernar 即可开始', d: '输入 / 展开指令，管理操作不消耗 Token' },
    { at: 20000, n: '03', t: '模式与审批，一键切换', d: 'Shift+Tab 切换 Code / Plan / Review · F2 切换审批档位' },
    { at: 30000, n: '04', t: '先读后改，计划实时可见', d: '任务计划卡片、工具调用摘要与 diff 同屏呈现' },
    { at: 40000, n: '05', t: '关键操作，由你批准', d: '终端命令需要审批，测试结果流式返回' },
    { at: 48000, n: '06', t: '交付，并说明验证结果', d: 'token/s、累计用量与上下文占用一目了然' },
  ];

  // ---------- pixel art, ported from cli/tui-art.js ----------
  const GLYPHS = {
    A: ['01110', '11011', '11011', '11111', '11011', '11011', '11011'],
    c: ['00000', '00000', '01111', '11000', '11000', '11000', '01111'],
    h: ['11000', '11000', '11110', '11011', '11011', '11011', '11011'],
    e: ['00000', '00000', '01110', '11011', '11111', '11000', '01111'],
    r: ['00000', '00000', '11011', '11100', '11000', '11000', '11000'],
    n: ['00000', '00000', '11110', '11011', '11011', '11011', '11011'],
    a: ['00000', '00000', '01110', '00011', '01111', '11011', '01111'],
  };
  function artwork(tick, compact) {
    const w = compact ? 23 : 74, h = compact ? 14 : 18;
    const px = Array.from({ length: h }, () => Array(w).fill(null));
    const put = (x, y, c) => { if (px[y] && x >= 0 && x < w) px[y][x] = c; };
    const cx = 11, cy = compact ? 6 : 8;
    for (let y = -4; y <= 4; y++)
      for (let x = -5; x <= 5; x++)
        if ((x * x) / 25 + (y * y) / 16 <= 1) put(cx + x, cy + y, y < -1 ? '#bdbdbd' : y > 1 ? '#747474' : '#dedede');
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2, x = Math.cos(a) * 10, y = Math.sin(a) * 3 - x * 0.35;
      if (Math.sin(a) > 0 || Math.abs(x) > 5) put(Math.round(cx + x), Math.round(cy + y), '#b0b0b0');
    }
    for (let i = 0; i < 3; i++) {
      const a = tick * 0.075 * (i === 1 ? -0.7 : 1) + i * 2.15;
      const x = Math.round(cx + Math.cos(a) * (i === 2 ? 8 : 11)), y = Math.round(cy + Math.sin(a) * (i === 2 ? 5 : 7));
      put(x, y, '#eeeeee');
      if (i === 0) { put(x - 1, y, '#868686'); put(x + 1, y, '#868686'); put(x, y - 1, '#868686'); put(x, y + 1, '#868686'); }
    }
    if (!compact)
      [...'Achernar'].forEach((l, i) => GLYPHS[l].forEach((row, y) => [...row].forEach((p, x) => {
        if (p === '1') put(27 + i * 6 + x, y + 5, i < 2 ? '#a4a4a4' : '#e6e6e6');
      })));
    return px;
  }
  // `reveal` 0..1 lights pixels in a seeded, scattered order (the "materialise" effect).
  function drawArt(canvas, tick, compact, cell, reveal = 1) {
    const px = artwork(tick, compact);
    const w = px[0].length * cell, h = px.length * cell;
    if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    const gap = Math.max(1, Math.round(cell * 0.08));
    px.forEach((row, y) => row.forEach((c, x) => {
      if (!c || hash(x, y) > reveal) return;
      g.fillStyle = c;
      g.fillRect(x * cell, y * cell, cell - gap, cell - gap);
    }));
  }
  // ---------- sky: seeded stars + pre-baked grain tiles ----------
  const rand = mulberry32(SEED);
  const STARS = Array.from({ length: 260 }, () => ({
    x: rand() * 1920, y: rand() * 1080, r: rand() < 0.08 ? 1.6 : 0.8 + rand() * 0.5,
    a: 0.15 + rand() * 0.55, ph: rand() * Math.PI * 2, sp: 0.4 + rand() * 1.4, z: 0.3 + rand() * 0.7,
  }));
  const GRAIN = Array.from({ length: 6 }, () => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d'), img = g.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rand() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  });
  function drawSky(g, t, zoom) {
    g.fillStyle = '#0a0a0b';
    g.fillRect(0, 0, 1920, 1080);
    const glow = g.createRadialGradient(960, 470, 40, 960, 470, 900);
    glow.addColorStop(0, 'rgba(255,255,255,0.045)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, 1920, 1080);
    for (const s of STARS) {
      // Parallax push: stars drift away from the centre as the camera zooms.
      const k = 1 + (zoom - 1) * s.z * 2.2;
      let x = 960 + (s.x - 960) * k - t * 0.004 * s.z;
      x = ((x % 1920) + 1920) % 1920;
      const y = 540 + (s.y - 540) * k;
      if (y < 0 || y > 1080) continue;
      const a = s.a * (0.6 + 0.4 * Math.sin(t / 1000 * s.sp + s.ph));
      g.fillStyle = `rgba(230,230,230,${a.toFixed(3)})`;
      g.fillRect(x, y, s.r, s.r);
    }
  }
  function drawGrain(g, t, on) {
    g.clearRect(0, 0, 1920, 1080);
    if (!on) return;
    const tile = GRAIN[Math.floor(t / 42) % GRAIN.length];
    g.globalAlpha = 0.07;
    for (let y = 0; y < 1080; y += 256) for (let x = 0; x < 1920; x += 256) g.drawImage(tile, x, y);
    g.globalAlpha = 1;
  }

  // ---------- terminal script ----------
  const TASK = '修复登录超时问题，运行相关测试';
  const MENU = [
    ['/model', 'Switch or create a model'], ['/mode', 'Code · Plan · Review'],
    ['/approval', 'Strict · Code · Auto'], ['/plan', 'Plan without writing'],
    ['/review', 'Review recent changes'], ['/files', 'Browse source files'],
    ['/search', 'Search the workspace'], ['/diff', 'Inspect working tree'],
  ];
  const STEPS = [
    ['Locate session timeout logic', 33400],
    ['Patch refresh window', 38800],
    ['Run auth tests', 45400],
    ['Summarize change', 50600],
  ];
  const ANSWER =
    'Sessions expired after 5 min because tokens were never refreshed before expiry.\n' +
    'Raised SESSION_TIMEOUT to 30 min, refresh 60 s before expiry, and added 2 regression tests.\n' +
    'Verified: npm test -- auth → 12 passed.';
  const TESTS = [
    '✔ refreshes token before expiry', '✔ expires idle sessions after 30 min',
    '✔ keeps remember-me cookie', '✔ rejects tampered tokens',
  ];
  const EVENTS = [
    [31900, () => `<div class="tool">● <i>files.read</i>  src/auth/session.js</div>`],
    [32500, () => `<div class="res">  └ 148 lines</div>`],
    [32900, () => `<div class="tool">● <i>search</i>  "SESSION_TIMEOUT"  --include src/**</div>`],
    [33400, () => `<div class="res">  └ 3 matches in 2 files</div>`],
    [34400, () => `<div class="tool">● <i>files.edit</i>  src/auth/session.js</div>`],
    [34800, (t) => diff(t, 34800, [
      ['del', '- const SESSION_TIMEOUT = 5 * 60 * 1000;'],
      ['add', '+ const SESSION_TIMEOUT = 30 * 60 * 1000;'],
      ['add', '+ const REFRESH_MARGIN = 60 * 1000;'],
    ])],
    [37200, () => `<div class="tool">● <i>files.edit</i>  tests/auth/session.test.js</div>`],
    [37700, () => `<div class="res">  └ +24 lines · 2 tests added</div>`],
    [39600, (t) => `<div class="tool">● <i>terminal</i>  npm test -- auth${t < 43000 ? '  <span class="muted">awaiting approval…</span>' : ''}</div>`],
    ...TESTS.map((line, i) => [43200 + i * 380, () => `<div class="ok">  ${line}</div>`]),
    [44900, () => `<div class="ok">  <b>12 passed</b> <span class="muted">· 0 failed · 1.8s</span></div>`],
    [45600, (t) => (t < 46600 ? `<div class="muted">${spin(t)} Summarizing…</div>` : '')],
    [46600, (t) => `<div class="answer">${esc(typed(ANSWER, t, 46600, 72))}${t < 50500 ? caret(t) : ''}</div>`],
    [51000, () => `<div class="muted" style="margin-top:8px">✔ Task complete · 5 tool calls · 21.0s</div>`],
  ];
  function diff(t, start, rows) {
    const shown = rows.filter((_, i) => t >= start + 300 + i * 450);
    return `<div class="diff">${shown.map(([k, s]) => `<div class="${k}">${esc(s)}</div>`).join('') || '&nbsp;'}</div>`;
  }
  function outputLines(t) {
    const out = [];
    if (t >= 30000) out.push(`<div class="user">${esc(TASK)}</div>`);
    if (t >= 30300) out.push(t < 31500 ? `<div class="muted">${spin(t)} Thinking…</div>` : `<div class="muted">✻ Thought for 1.4s</div>`);
    for (const [at, fn] of EVENTS) if (t >= at) out.push(fn(t));
    return out.join('');
  }
  function planCard(t) {
    if (t < 31600) return '';
    const done = STEPS.filter(([, at]) => t >= at).length;
    const rows = STEPS.map(([label], i) => {
      const state = i < done ? 'done' : i === done && t < 51000 ? 'active' : '';
      const mark = i < done ? '■' : state === 'active' ? spin(t) : '□';
      return `<div class="step ${state}">${mark} ${esc(label)}</div>`;
    }).join('');
    return `<div class="plan"><div class="head">Plan <span>${done}/${STEPS.length} · F5</span></div>${rows}</div>`;
  }
  const SLASH = [[13000, '/'], [15600, '/m'], [15850, '/mo'], [17000, '/mode ']];
  function inputBox(t) {
    let text = '';
    if (t >= 13000 && t < 18000) text = SLASH.filter(([at]) => t >= at).pop()[1];
    if (t >= 27600 && t < 30000) text = typed(TASK, t, 27600, 9);
    const body = text ? esc(text) + caret(t) : `${caret(t)}<span class="ph">Ask Achernar to change code, or type / for commands</span>`;
    return `<div class="input">${body}</div>`;
  }
  function menu(t) {
    if (t < 13100 || t >= 17000) return '';
    const items = t >= 15850 ? MENU.filter(([c]) => c.startsWith('/mo')) : t >= 15600 ? MENU.filter(([c]) => c.startsWith('/m')) : MENU;
    const hover = t >= 15600 ? (t >= 16300 ? 1 : 0) : Math.min(items.length - 1, Math.floor(Math.max(0, t - 13600) / 280));
    const rows = items.map(([c, d], i) => `<div class="${i === hover ? 'hl' : ''}">${c}<span>${d}</span></div>`).join('');
    return `<div class="menu">${rows}</div>`;
  }
  // Mode / approval changes are keyed by time so the chips stay in sync with the toasts.
  const MODES = [[0, 'Code'], [21500, 'Plan'], [22600, 'Review'], [23700, 'Code']];
  const APPROVALS = [[0, 'Strict'], [25400, 'Code']];
  const at = (list, t) => list.filter(([a]) => t >= a).pop()[1];
  function chips(t) {
    const group = (names, on) => names.map((n) => `<span class="chip ${n === on ? 'on' : ''}">${n}</span>`).join('');
    return `<div class="chips">${group(['Code', 'Plan', 'Review'], at(MODES, t))}<span class="muted" style="margin:0 6px">·</span>${group(['Strict', 'Code', 'Auto'], at(APPROVALS, t))}</div>`;
  }
  const KEYS = [
    [17000, 17700, 'Tab', 'complete'], [17700, 18300, 'Esc', 'close'],
    [21200, 24400, 'Shift+Tab', 'cycle mode'], [25100, 26600, 'F2', 'cycle approval'],
    [29500, 30300, 'Enter', 'send'], [42300, 43000, 'Enter', 'allow once'],
  ];
  const TOASTS = [[21500, 'Mode · Plan (read-only)'], [22600, 'Mode · Review (read-only)'], [23700, 'Mode · Code'], [25400, 'Approval · Code — reads & edits auto-approved']];
  function overlays(t) {
    let html = menu(t);
    const key = KEYS.find(([a, b]) => t >= a && t < b);
    if (key) html += `<div class="keycap"><kbd>${key[2]}</kbd>${key[3]}</div>`;
    const toast = TOASTS.filter(([a]) => t >= a && t < a + 1300).pop();
    if (toast) html += `<div class="toast">${esc(toast[1])}</div>`;
    if (t >= 40300 && t < 43100) {
      const k = fade(t, 40300, 40600, 42800, 43100);
      const hl = t >= 41200 ? 0 : -1;
      const opts = ['Allow once', 'Deny', 'Strict', 'Code', 'Auto'].map((o, i) => `<span class="${i === hl ? 'hl' : ''}">${o}</span>`).join('');
      html += `<div class="dialog" style="opacity:${k.toFixed(3)};transform:translate(-50%,-50%) scale(${lerp(0.96, 1, k).toFixed(4)})">
        <h3>Allow terminal command?</h3><div class="cmdline">npm test -- auth</div>
        <div class="muted">cwd D:\\Projects\\Website · approval: Code</div><div class="opts">${opts}</div></div>`;
    }
    return html;
  }
  function footer(t) {
    const busy = t >= 30000 && t < 51000 && !(t >= 40300 && t < 43000);
    const rate = busy ? 58 + 14 * Math.sin(t / 370) + 6 * Math.sin(t / 130) : 0;
    const used = Math.round(lerp(0, 18460, seg(t, 30000, 51000, (k) => k)));
    const ctx = lerp(2, 14, seg(t, 30000, 51000, (k) => k));
    return `<div class="foot"><span>${rate.toFixed(1)} tok/s · ${used.toLocaleString('en-US')} tokens</span><span>context ${ctx.toFixed(0)}%<i class="ctx"><i style="width:${ctx.toFixed(1)}%"></i></i></span></div>`;
  }
  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), sky = $('sky').getContext('2d'), grain = $('grain').getContext('2d');
  const title = $('title'), art = $('art'), term = $('term'), out = $('out'), dock = $('dock'), overlay = $('overlay');
  const caption = $('caption'), live = $('live');
  const titleParts = [...title.querySelectorAll('.code, .motto, .cmd')];
  // Persistent head (shell line + banner canvas) so the canvas is not recreated each frame.
  out.innerHTML = `<div class="shell" id="shell"></div><div class="banner" id="banner"><canvas id="mini"></canvas>
    <div><div class="name">Achernar Code</div><div class="sub">0.2.0 · your-model · D:\\Projects\\Website</div></div></div><div id="lines"></div>`;
  const shell = $('shell'), banner = $('banner'), mini = $('mini'), lines = $('lines');
  lines.style.display = 'contents';
  const cache = new Map();
  const set = (el, key, html) => { if (cache.get(key) !== html) { cache.set(key, html); el.innerHTML = html; } };
  let grainOn = true, shotIndex = -1;

  function render(t) {
    t = clamp(t, 0, DURATION);
    const tick = t / 100; // the CLI advances its animation tick every 100 ms

    // Camera: slow push-in on the title, fly-through into the terminal, pull back at the end.
    const intro = seg(t, 9000, 10600);
    const outro = seg(t, 53600, 55600);
    // Continuous across the whole minute and back to 1.0 at the end, so the loop seam is clean.
    const zoom = 1 + 0.04 * seg(t, 0, 10000, (k) => k) + 0.5 * intro - 0.54 * outro;
    drawSky(sky, t, zoom);
    drawGrain(grain, t, grainOn);

    // Title card (shot 01, then again as the end card).
    const titleIn = t < 30000 ? fade(t, 400, 1600, 9200, 10200) : seg(t, 54600, 56200);
    const titleEnd = 1 - seg(t, 59200, 60000);
    title.style.opacity = (titleIn * titleEnd).toFixed(3);
    title.style.transform = `scale(${(t < 30000 ? 1 + t / 10000 * 0.03 + intro * 0.35 : lerp(0.94, 1, easeOut(seg(t, 54600, 57000)))).toFixed(4)})`;
    const reveal = t < 30000 ? seg(t, 500, 3800, easeOut) : seg(t, 54600, 56400, easeOut);
    if (titleIn > 0) drawArt(art, tick, false, 14, reveal);
    const partStart = t < 30000 ? 3600 : 55600;
    titleParts.forEach((el, i) => { el.style.opacity = seg(t, partStart + i * 700, partStart + i * 700 + 800).toFixed(3); });

    // Terminal window (shots 02–06).
    const termIn = seg(t, 9600, 10800, easeOut) * (1 - seg(t, 53800, 55200));
    term.style.opacity = termIn.toFixed(3);
    term.style.visibility = termIn > 0 ? 'visible' : 'hidden';
    const termScale = t < 30000 ? lerp(1.08, 1, termIn) : lerp(0.9, 1, 1 - outro);
    term.style.transform = `translateY(${((1 - termIn) * 24).toFixed(1)}px) scale(${termScale.toFixed(4)})`;
    if (termIn > 0) {
      const cmd = typed('achernar', t, 10400, 11);
      set(shell, 'shell', `PS D:\\Projects\\Website&gt; <b>${cmd}</b>${t < 11300 ? caret(t) : ''}`);
      const b = seg(t, 11300, 12300, easeOut);
      banner.style.opacity = b.toFixed(3);
      if (b > 0) drawArt(mini, tick, true, 5, b);
      set(lines, 'lines', outputLines(t));
      // Empty session: banner sits at the top like the CLI; once a task runs, output scrolls from the bottom.
      out.style.justifyContent = t >= 30000 ? 'flex-end' : 'flex-start';
      dock.style.opacity = seg(t, 11800, 12600).toFixed(3);
      set(dock, 'dock', planCard(t) + chips(t) + inputBox(t) + footer(t));
      set(overlay, 'overlay', overlays(t));
    }

    // Captions follow the storyboard; announced once per shot for screen readers.
    let idx = 0;
    SHOTS.forEach((s, i) => { if (t >= s.at) idx = i; });
    const s = SHOTS[idx], next = SHOTS[idx + 1] ? SHOTS[idx + 1].at : 54000;
    caption.style.opacity = fade(t, s.at + 500, s.at + 1100, next - 700, next - 150).toFixed(3);
    if (idx !== shotIndex) {
      shotIndex = idx;
      caption.innerHTML = `<span class="num">${s.n}</span><div><div class="t">${esc(s.t)}</div><div class="d">${esc(s.d)}</div></div>`;
      live.textContent = `${s.n} ${s.t}。${s.d}`;
    }
    return t;
  }
  // ---------- playback ----------
  const params = new URLSearchParams(location.search);
  const exporting = params.has('export');
  const fit = () => {
    const vp = $('viewport');
    const scale = exporting ? 1 : Math.min(vp.clientWidth / 1920, vp.clientHeight / 1080);
    stage.style.setProperty('--scale', scale);
  };
  addEventListener('resize', fit);
  if (exporting) document.body.classList.add('export');
  fit();

  // Deterministic entry points for the frame exporter and for screenshots.
  window.achernarAnimation = { duration: DURATION, shots: SHOTS, render, setGrain: (on) => { grainOn = on; } };
  const startAt = Number(params.get('t')) || 0;
  if (exporting) { render(startAt); return; }

  const play = $('play'), seek = $('seek'), time = $('time'), loop = $('loop');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let playing = !reduced && !params.has('t'), pos = startAt, last = performance.now();
  $('grainToggle').addEventListener('change', (e) => { grainOn = e.target.checked; render(pos); });
  const sync = () => {
    play.textContent = playing ? '❚❚' : '▶';
    play.setAttribute('aria-label', playing ? '暂停' : '播放');
    seek.value = Math.round(pos);
    time.textContent = `${(pos / 1000).toFixed(1).padStart(4, '0')} / 60.0`;
  };
  const toggle = () => { if (!playing && pos >= DURATION) pos = 0; playing = !playing; last = performance.now(); sync(); };
  play.addEventListener('click', toggle);
  $('reset').addEventListener('click', () => { pos = 0; playing = true; last = performance.now(); render(pos); sync(); });
  seek.addEventListener('input', () => { pos = Number(seek.value); render(pos); sync(); });
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (e.target === seek) return; // the slider handles its own arrows
      pos = clamp(pos + (e.key === 'ArrowRight' ? 5000 : -5000), 0, DURATION); render(pos); sync();
    } else if (e.key === 'Home') { pos = 0; render(pos); sync(); }
  });
  function frame(now) {
    if (playing) {
      pos += Math.min(100, now - last); // cap the step so a background tab does not skip shots
      if (pos >= DURATION) {
        if (loop.checked) pos %= DURATION;
        else { pos = DURATION; playing = false; }
      }
    }
    last = now;
    render(pos);
    sync();
    requestAnimationFrame(frame);
  }
  sync();
  requestAnimationFrame(frame);
})();
