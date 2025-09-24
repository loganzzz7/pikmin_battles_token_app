// ========== CONFIG ==========
const BACKEND_URL = window.BACKEND_URL || "http://127.0.0.1:8787";
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
  const survivorCountEl = document.getElementById("survivorCount");
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
    const tick = () => {
      const secs = secondsUntil(state?.breakEndsAt);
      battleCountdownEl.textContent = `${secs}s`;
    };
    tick();
    const id = setInterval(() => {
      const secs = secondsUntil(state?.breakEndsAt);
      battleCountdownEl.textContent = `${secs}s`;
      if (secs === 0) clearInterval(id);
    }, 1000);
  }

  // Survivors (fallback to total holders)
  if (survivorCountEl) {
    const survivors =
      typeof state?.survivorCount === "number"
        ? state.survivorCount
        : holders?.total ?? holders?.items?.length ?? 0;
    survivorCountEl.textContent = String(survivors);
  }

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