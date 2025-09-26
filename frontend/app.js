// ========== CONFIG ==========
const BACKEND_URL = window.BACKEND_URL || "http://127.0.0.1:8000";
const COIN_ADDRESS =
  window.COIN_ADDRESS || "So11111111111111111111111111111111111111112";

// Set CA in header immediately (no backend dependency)
const coinCAEl = document.getElementById("coinca");
if (coinCAEl) coinCAEl.textContent = COIN_ADDRESS;

// Team color classes
const TEAM_COLORS = {
  red: "text-redN",
  purple: "text-purpleN",
  blue: "text-blueN",
  yellow: "text-yellowN",
};

// add near your palettes
const TEAM_BG = {
  red: "#fecaca", // red-200
  yellow: "#fef08a", // yellow-200
  blue: "#bfdbfe", // blue-200
  purple: "#e9d5ff"  // purple-200
};

// ========== HELPERS ==========
const LAMPORTS_PER_SOL = 1_000_000_000n;

async function safeJSON(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function lamportsToSol(lamports) {
  try {
    const raw = BigInt(String(lamports));
    return Number(raw) / Number(LAMPORTS_PER_SOL);
  } catch {
    const n = Number(lamports);
    return Number.isFinite(n) ? n / 1_000_000_000 : 0;
  }
}

function secondsUntil(isoString) {
  if (!isoString) return 0;
  const end = Date.parse(isoString);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - Date.now()) / 1000));
}

function renderEmpty(el) {
  el.innerHTML =
    '<div class="py-8 text-center text-sm text-slate-400">No results.</div>';
}

// ========== DATA LOADERS ==========
async function loadState() {
  return await safeJSON(`${BACKEND_URL}/state.json`);
}
async function loadHolders() {
  return await safeJSON(`${BACKEND_URL}/holders`);
}
async function loadHistory() {
  return await safeJSON(`${BACKEND_URL}/history`);
}

// ========== HOME PAGE ==========
async function renderHome() {
  const prizePoolEl = document.getElementById("prizePool");
  if (!prizePoolEl) return; // not on home page

  const gameNumberEl = document.getElementById("gameNumber");
  const battleCountdownEl = document.getElementById("battleCountdown");
  // const survivorCountEl = document.getElementById("survivorCount");
  const holdersListEl = document.getElementById("holdersList");
  const holdersCountEl = document.getElementById("holdersCount");
  const historyListEl = document.getElementById("historyList");

  const [state, holders, history] = await Promise.all([
    loadState(),
    loadHolders(),
    loadHistory(),
  ]);

  // Prize pool
  const prizeSpan = prizePoolEl.querySelector("span") || prizePoolEl;
  const prizeSOL = state ? lamportsToSol(state.prizePoolLamports) : 0;
  prizeSpan.textContent = `${prizeSOL.toFixed(4)} SOL`;

  // Game #
  if (gameNumberEl) {
    gameNumberEl.textContent = `#${state?.roundNumber ?? "--"}`;
  }

  // Countdown
  if (battleCountdownEl) {
    const phase = state?.phase;
    if (phase === "RUNNING") {
      battleCountdownEl.textContent = "LIVE";
      battleCountdownEl.classList.add("text-green-400");
    } else {
      const secs = typeof state?.secondsLeft === "number"
        ? state.secondsLeft
        : secondsUntil(state?.breakEndsAt);
      battleCountdownEl.textContent = `${secs}s`;
      battleCountdownEl.classList.remove("text-green-400");
    }
  }

  // Survivors (fallback to total holders)
  // if (survivorCountEl) {
  //   const survivors =
  //     typeof state?.survivorCount === "number"
  //       ? state.survivorCount
  //       : holders?.total ?? holders?.items?.length ?? 0;
  //   survivorCountEl.textContent = String(survivors);
  // }

  // Holders preview
  if (holdersListEl) {
    const items = holders?.items || [];
    if (!items.length) {
      renderEmpty(holdersListEl);
    } else {
      holdersListEl.innerHTML = "";
      items.slice(0, 20).forEach((h) => {
        const row = document.createElement("div");
        row.className =
          "flex items-center justify-between rounded-md bg-black/20 px-3 py-2";
        row.innerHTML = `
          <span class="text-xs truncate pr-2">${h.address}</span>
          <span class="text-xs font-semibold capitalize ${TEAM_COLORS[h.team] || ""}">${h.team}</span>
        `;
        holdersListEl.appendChild(row);
      });
    }
  }

  // Holder count
  if (holdersCountEl) {
    const total = holders?.total ?? holders?.items?.length ?? 0;
    holdersCountEl.textContent = String(total);
  }

  // Match history
  if (historyListEl) {
    const rows = Array.isArray(history) ? history : [];
    if (!rows.length) {
      renderEmpty(historyListEl);
    } else {
      historyListEl.innerHTML = "";
      rows.forEach((m) => {
        const prize =
          typeof m.prizeSOL === "number"
            ? m.prizeSOL
            : lamportsToSol(m.prizeLamports || 0);
        const row = document.createElement("div");
        row.className =
          "flex items-center justify-between rounded-md bg-black/20 px-3 py-2";
        row.innerHTML = `
          <span class="text-xs font-semibold capitalize ${TEAM_COLORS[m.team] || ""}">${m.team}</span>
          <span class="text-xs">${prize.toFixed(3)} SOL</span>
        `;
        historyListEl.appendChild(row);
      });
    }
  }
}
renderHome();
setInterval(renderHome, 1000);

async function syncSimWithState() {
  const state = await loadState();
  const phase = state?.phase;

  if (phase === "RUNNING") {
    if (!ArenaSim.isActive()) ArenaSim.start();
  } else {
    if (ArenaSim.isActive()) ArenaSim.stop();
  }
}

// kick off and poll every second
syncSimWithState();
setInterval(syncSimWithState, 1000);

// ========== HOLDERS PAGE ==========
async function renderHoldersPage() {
  const tokenAddressEl = document.getElementById("tokenAddress");
  if (!tokenAddressEl) return; // not on holders page

  const totalParticipantsEl = document.getElementById("totalParticipants");
  const lastUpdatedEl = document.getElementById("lastUpdated");
  const searchInput = document.getElementById("searchInput");
  const searchBtn = document.getElementById("searchBtn");
  const resultsEl = document.getElementById("searchResults");

  const holders = await loadHolders();

  const total = holders?.total ?? holders?.items?.length ?? 0;
  if (totalParticipantsEl) totalParticipantsEl.textContent = String(total);
  tokenAddressEl.textContent = holders?.tokenAddress || "-";
  if (lastUpdatedEl) {
    lastUpdatedEl.textContent = holders?.lastUpdatedISO
      ? new Date(holders.lastUpdatedISO).toLocaleString()
      : "-";
  }

  const all = holders?.items || [];
  function renderList(list) {
    if (!list.length) return renderEmpty(resultsEl);
    resultsEl.innerHTML = "";
    list.forEach((h) => {
      const row = document.createElement("div");
      row.className = "flex items-center justify-between px-2 py-2";
      row.innerHTML = `
        <span class="text-xs md:text-sm truncate pr-2">${h.address}</span>
        <span class="text-xs md:text-sm font-semibold capitalize ${TEAM_COLORS[h.team] || ""}">${h.team}</span>
      `;
      resultsEl.appendChild(row);
    });
  }
  renderList(all);

  function doSearch() {
    const q = (searchInput?.value || "").trim().toLowerCase();
    if (!q) return renderList(all);
    renderList(all.filter((h) => h.address.toLowerCase().includes(q)));
  }
  searchBtn?.addEventListener("click", doSearch);
  searchInput?.addEventListener("keydown", (e) => e.key === "Enter" && doSearch());
}
renderHoldersPage();

// --- HP overlay renderer (unchanged) ---
function renderHpOverlay() {
  const rows = ArenaSim.snapshot();
  const map = new Map(rows.map(r => [r.team, r.hp]));
  const r = document.getElementById("hpRed");
  const p = document.getElementById("hpPurple");
  const b = document.getElementById("hpBlue");
  const y = document.getElementById("hpYellow");
  if (r) r.textContent = map.get("red") ?? "-";
  if (p) p.textContent = map.get("purple") ?? "-";
  if (b) b.textContent = map.get("blue") ?? "-";
  if (y) y.textContent = map.get("yellow") ?? "-";
}

// ======== CANVAS SIM (HP + SPAWNING ITEMS + ELIMINATION) ========
const TEAM_PALETTE = { red: "#ff3860", purple: "#b76cff", blue: "#3ec4ff", yellow: "#ffe259" };

// --- HP / scaling tuning ---
const MAX_HP = 5;
const SPEED_DELTA = 0.10;  // +10% speed per HP lost
const MASS_DELTA = 0.10;  // -10% mass per HP lost
const SIZE_DELTA = 0.10;  // -10% radius per HP lost
const MIN_MASS_FACTOR = 0.25;
const MIN_SIZE_FACTOR = 0.60;

// --- Item tuning ---
const ITEM_SPAWN_MS = 3000;   // spawn every ~3s
const ITEM_LIFETIME = null;   // despawn after 8s
const ITEM_RAD_BULBORB_FACTOR = 0.75;  // relative to circle baseR
const ITEM_RAD_FLOWER_FACTOR = 0.60;

// Preload images (adjust paths if needed)
const IMG_BULBORB = new Image();
IMG_BULBORB.src = "./assets/bulborb.png"; // -1 HP
const IMG_FLOWER = new Image();
IMG_FLOWER.src = "./assets/flower.png";  // +1 HP

// Team sprites
const IMG_TEAM = {
  red: new Image(),
  yellow: new Image(),
  blue: new Image(),
  purple: new Image(),
};
IMG_TEAM.red.src = "./assets/red_pikmin.png";
IMG_TEAM.yellow.src = "./assets/yellow_pikmin.png";
IMG_TEAM.blue.src = "./assets/blue_pikmin.png";
IMG_TEAM.purple.src = "./assets/purple_pikmin.png";

function hpSpeedMult(hp) { return 1 + SPEED_DELTA * (MAX_HP - hp); }
function hpMass(baseMass, hp) { return baseMass * Math.max(MIN_MASS_FACTOR, 1 - MASS_DELTA * (MAX_HP - hp)); }
function hpRadius(baseR, hp) { return baseR * Math.max(MIN_SIZE_FACTOR, 1 - SIZE_DELTA * (MAX_HP - hp)); }

const ArenaSim = (() => {
  let ctx, canvas, wrap;
  let rafId = null;
  let active = false;

  let circles = [];
  let items = [];                // { kind:'bulborb'|'flower', x,y, r, born:number }
  let last = 0;
  let acc = 0;
  let spawnAcc = 0;              // ms accumulator for spawns
  let baseRForItems = 20;        // updated at start/resize

  const dt = 1 / 60;
  const dtMs = dt * 1000;

  let tickCb = null;

  let winnerCb = null;
  let winnerSent = false;

  function onWinner(cb) { winnerCb = cb; }

  function ensureCanvas() {
    if (canvas) return true;
    wrap = document.getElementById("arenaWrap");
    canvas = document.getElementById("arena");
    if (!wrap || !canvas) return false;
    resize();
    ctx = canvas.getContext("2d");
    window.addEventListener("resize", onResize);
    return true;
  }
  function resize() {
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
  }
  function onResize() {
    if (!canvas) return;
    const W1 = canvas.width, H1 = canvas.height;
    resize();
    const W2 = canvas.width, H2 = canvas.height;
    if (W1 && H1 && (W1 !== W2 || H1 !== H2)) {
      const sx = W2 / W1, sy = H2 / H1;
      for (const c of circles) {
        c.x *= sx; c.y *= sy;
        c.baseR = Math.max(12, Math.floor(Math.min(W2, H2) * 0.065));
        applyHPScaling(c);
      }
      baseRForItems = Math.max(12, Math.floor(Math.min(W2, H2) * 0.065));
      for (const it of items) it.r = itemRadiusForKind(it.kind);
    }
  }

  // init from corners
  function makeInitialCircles(W, H) {
    const baseR = Math.max(12, Math.floor(Math.min(W, H) * 0.065));
    baseRForItems = baseR;
    const pad = baseR + 12;
    const cx = W / 2, cy = H / 2;
    const starts = [
      { id: "blue", team: "blue", x: pad, y: pad },
      { id: "yellow", team: "yellow", x: W - pad, y: pad },
      { id: "purple", team: "purple", x: pad, y: H - pad },
      { id: "red", team: "red", x: W - pad, y: H - pad },
    ];

    // --- Speed tuning ---
    const BASE_SPEED_FACTOR = 0.4;
    const MIN_BASE_SPEED = 250;
    const baseSpeed = Math.max(MIN_BASE_SPEED, Math.min(W, H) * BASE_SPEED_FACTOR); // px/s
    const baseMass = 1;

    circles = starts.map(s => {
      const dx = cx - s.x, dy = cy - s.y;
      const len = Math.hypot(dx, dy) || 1;
      return {
        id: s.id, team: s.team,
        x: s.x, y: s.y,
        dirx: dx / len, diry: dy / len, // direction; speed derived from HP
        baseSpeed, speed: baseSpeed,
        baseMass, mass: baseMass,
        baseR, r: baseR,
        hp: MAX_HP,
      };
    });
    for (const c of circles) applyHPScaling(c);
  }

  function applyHPScaling(c) {
    c.speed = c.baseSpeed * hpSpeedMult(c.hp);
    c.vx = c.dirx * c.speed;
    c.vy = c.diry * c.speed;
    c.mass = hpMass(c.baseMass, c.hp);
    c.r = hpRadius(c.baseR, c.hp);
  }

  // public HP update (with elimination)
  function updateHP(idOrTeam, newHp) {
    const c = circles.find(z => z.id === idOrTeam || z.team === idOrTeam);
    if (!c) return;
    c.hp = Math.max(0, Math.min(MAX_HP, newHp));
    if (c.hp === 0) {
      // Don't rescale; mark eliminated and purge after pickups
      c._eliminate = true;
      return;
    }
    applyHPScaling(c);
  }

  // remove any circles flagged/eliminated (hp <= 0)
  function pruneEliminated() {
    if (!circles.length) return;
    const before = circles.length;
    circles = circles.filter(c => !c._eliminate && c.hp > 0);
    const after = circles.length;

    // If we just reached exactly 1 and haven't reported yet, announce winner
    if (!winnerSent && before > 1 && after === 1) {
      winnerSent = true;
      const last = circles[0];
      if (winnerCb && last) winnerCb(last.team);
    }
  }

  // -------- items ----------
  const PROB_BULBORB = 0.75;

  function itemRadiusForKind(kind) {
    return (kind === "bulborb" ? ITEM_RAD_BULBORB_FACTOR : ITEM_RAD_FLOWER_FACTOR) * baseRForItems;
  }

  function randomItemKind() {
    return Math.random() < PROB_BULBORB ? "bulborb" : "flower";
  }

  function spawnRandomItem() {
    const W = canvas.width, H = canvas.height;
    const kind = randomItemKind();
    const r = itemRadiusForKind(kind);
    const x = r + Math.random() * (W - 2 * r);
    const y = r + Math.random() * (H - 2 * r);
    items.push({ kind, x, y, r, born: performance.now() });
  }

  function updateItems(stepMs) {
    // spawn
    spawnAcc += stepMs;
    while (spawnAcc >= ITEM_SPAWN_MS) {
      spawnRandomItem();
      spawnAcc -= ITEM_SPAWN_MS;
    }

    // pickups only (no age-based removal)
    let i = 0;
    while (i < items.length) {
      const it = items[i];
      let consumed = false;

      // iterate over a copy in case circles array changes (eliminations)
      for (const c of [...circles]) {
        const dx = c.x - it.x, dy = c.y - it.y;
        if (Math.hypot(dx, dy) <= c.r + it.r) {
          // capture direction before HP change
          const speedNow = Math.hypot(c.vx, c.vy) || 1;
          const ux = c.vx / speedNow, uy = c.vy / speedNow;

          // apply hp change (no knockback)
          const delta = it.kind === "flower" ? +1 : -1;
          updateHP(c.id, c.hp + delta);

          // if still alive, restore direction & nudge forward
          if (!c._eliminate && c.hp > 0) {
            c.dirx = ux; c.diry = uy;
            c.vx = ux * c.speed; c.vy = uy * c.speed;
            const nudge = Math.max(1, it.r * 0.15);
            c.x += ux * nudge; c.y += uy * nudge;
          }

          consumed = true;
          break;
        }
      }

      if (consumed) {
        items.splice(i, 1); // item is consumed on pickup
      } else {
        i++;
      }
    }

    // prune eliminated circles (unchanged)
    pruneEliminated();
  }

  function drawItems() {
    for (const it of items) {
      const img = it.kind === "bulborb" ? IMG_BULBORB : IMG_FLOWER;
      const size = it.r * 2;
      const x = it.x - it.r, y = it.y - it.r;
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, x, y, size, size);
      } else {
        // fallback while loading
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
        ctx.fillStyle = it.kind === "bulborb" ? "#ff9c54" : "#ffffff";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = it.kind === "bulborb" ? "#dd6c1a" : "#d1d5db";
        ctx.stroke();
      }
    }
  }
  // -------------------------

  // physics
  function collide(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const overlap = a.r + b.r - dist;
    if (overlap <= 0) return;

    const nx = dx / dist, ny = dy / dist;
    const shift = overlap / 2 + 0.01;
    a.x -= nx * shift; a.y -= ny * shift;
    b.x += nx * shift; b.y += ny * shift;

    const tx = -ny, ty = nx;
    const v1n = a.vx * nx + a.vy * ny;
    const v1t = a.vx * tx + a.vy * ty;
    const v2n = b.vx * nx + b.vy * ny;
    const v2t = b.vx * tx + b.vy * ty;

    const m1 = a.mass, m2 = b.mass;
    const v1nPrime = (v1n * (m1 - m2) + 2 * m2 * v2n) / (m1 + m2);
    const v2nPrime = (v2n * (m2 - m1) + 2 * m1 * v1n) / (m1 + m2);

    a.vx = v1nPrime * nx + v1t * tx;
    a.vy = v1nPrime * ny + v1t * ty;
    b.vx = v2nPrime * nx + v2t * tx;
    b.vy = v2nPrime * ny + v2t * ty;

    const as = Math.hypot(a.vx, a.vy) || 1, bs = Math.hypot(b.vx, b.vy) || 1;
    a.dirx = a.vx / as; a.diry = a.vy / as;
    b.dirx = b.vx / bs; b.diry = b.vy / bs;
    a.vx = a.dirx * a.speed; a.vy = a.diry * a.speed;
    b.vx = b.dirx * b.speed; b.vy = b.diry * b.speed;
  }
  function wallBounce(c, W, H) {
    if (c.x - c.r < 0) { c.x = c.r; c.vx = Math.abs(c.vx); }
    if (c.x + c.r > W) { c.x = W - c.r; c.vx = -Math.abs(c.vx); }
    if (c.y - c.r < 0) { c.y = c.r; c.vy = Math.abs(c.vy); }
    if (c.y + c.r > H) { c.y = H - c.r; c.vy = -Math.abs(c.vy); }
  }
  function physicsStep(stepMs) {
    const W = canvas.width, H = canvas.height;
    for (const c of circles) {
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      wallBounce(c, W, H);
    }
    for (let i = 0; i < circles.length; i++)
      for (let j = i + 1; j < circles.length; j++)
        collide(circles[i], circles[j]);

    updateItems(stepMs);
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // draw items first (under the Pikmin)
    drawItems();

    function drawImageCover(img, dx, dy, dSize) {
      const dw = dSize, dh = dSize;
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      if (!iw || !ih) return;

      const sRatio = iw / ih;
      const dRatio = dw / dh;

      let sw, sh, sx, sy;
      if (sRatio > dRatio) {
        sh = ih;
        sw = ih * dRatio;
        sx = (iw - sw) / 2;
        sy = 0;
      } else {
        sw = iw;
        sh = iw / dRatio;
        sx = 0;
        sy = (ih - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    }

    ctx.imageSmoothingEnabled = true;

    for (const c of circles) {
      const img = IMG_TEAM[c.team];
      const size = c.r * 2;
      const x = c.x - c.r;
      const y = c.y - c.r;

      // 1) tinted chip background (team *-100)
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fillStyle = TEAM_BG[c.team] || "#ffffff";
      ctx.fill();

      // 2) clip to circle and draw sprite cover-fit
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.clip();
        drawImageCover(img, x, y, size);
        ctx.restore();
      } else {
        // fallback while image loads
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fillStyle = TEAM_PALETTE[c.team] || "#bbb";
        ctx.fill();
      }

      // 3) black border
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#000000";
      ctx.stroke();
    }
  }

  function loop(now) {
    if (!active) return;
    let elapsed = now - last;
    if (elapsed > 100) elapsed = 100;
    last = now;

    acc += elapsed;
    while (acc >= dtMs) {
      physicsStep(dtMs);
      acc -= dtMs;
    }

    draw();
    if (typeof tickCb === "function") tickCb();
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (!ensureCanvas()) return;
    if (active) return;
    resize();
    makeInitialCircles(canvas.width, canvas.height);
    // reset items + timers
    items.length = 0;
    spawnAcc = 0;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    active = true;
    last = performance.now();
    acc = 0;
    rafId = requestAnimationFrame(loop);
    winnerSent = false;
  }

  function stop() {
    if (!canvas || !ctx) return;
    active = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    acc = 0;
    items.length = 0;
    spawnAcc = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    winnerSent = false;
  }

  function snapshot() { return circles.map(c => ({ team: c.team, hp: c.hp })); }
  function onTick(cb) { tickCb = cb; }

  return { start, stop, isActive: () => active, updateHP, snapshot, onTick, onWinner };
})();

// Register overlay updater *after* ArenaSim exists
ArenaSim.onTick(renderHpOverlay);

let _winnerHideId = null;

// winner display
function showWinnerModal(team) {
  // create or reuse
  let el = document.getElementById("winnerModal");
  if (!el) {
    el = document.createElement("div");
    el.id = "winnerModal";
    el.className = "fixed inset-0 z-[9999] flex items-center justify-center";
    el.innerHTML = `
      <div class="absolute inset-0 bg-black/60"></div>
      <div class="relative z-10 rounded-xl border-2 border-teal-300 bg-card px-6 py-5 shadow-card">
        <div class="text-center text-xl font-semibold">
          <span id="winnerText"></span>
        </div>
      </div>
    `;
    document.body.appendChild(el);
  }

  const txt = el.querySelector("#winnerText");
  txt.textContent = `${team.toUpperCase()} won!`;
  el.style.display = "flex";

  // clear any previous hide timer, then set a fresh 3s timer
  if (_winnerHideId) clearTimeout(_winnerHideId);
  _winnerHideId = setTimeout(() => {
    el.style.display = "none";
    _winnerHideId = null;
  }, 3000);
}

async function notifyBackendWinner(team) {
  // get current round to send
  const st = await loadState();
  const round = st?.roundNumber ?? 0;
  try {
    await fetch(`${BACKEND_URL}/winner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ round, team })
    });
  } catch { }
}

ArenaSim.onWinner(async (team) => {
  showWinnerModal(team);
  await notifyBackendWinner(team);
  // stop locally so the arena clears immediately; backend will switch to BREAK
  ArenaSim.stop();
});