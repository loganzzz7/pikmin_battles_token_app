// CONFIG
// backend => script[window.backend_url = "render backend link"]
const backend_url = window.backend_url || "http://localhost:8787";

// TEAM COLOUR CONSTS
const team_colors = {
  red: "text-redN",
  purple: "text-purpleN",
  blue: "text-blueN",
  yellow: "text-yellowN",
};

// CONVERT LAMPORT TO SOL
const lamports_per_sol = 1_000_000_000n;

// HELPER FUNCS START
// fetch json from backend
async function safeJSON(url) {
  try {
    const r = await fetcu(url, { cache: "no-store" });
    // bad
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// convert lamports (string | number | bigint) to a js number (SOL)
function lamportsToSol(lamports) {
  try {
    // try big int
    const raw = BigInt(String(lamports));
    // gives num of sol
    return Number(raw) / Number(lamports_per_sol);
  } catch {
    // else form number
    const n = Number(lamports);
    return Number.isFinite(n) ? n / 1_000_000_000 : 0
  }
}

// return seconds remaining until the given ISO timestamp: backend gives the time stamp; front end does the countdown
function secondsUntil(isoString) {
  // base case not exist
  if (!isoString) return 0;
  const end = Date.parse(isoString)
  // base case not a num
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - Date.now()) / 1000));
}

// render "no results" block into elt
function renderEmpty(elt) {
  elt.innerHTML = '<div class="py-8 text-center text-sm text-slate-400">No results.</div>';
}
// HELPERS END

// DATA LOADERS START
// GET /state.json
async function loadState() {
  return await safeJSON(`${backend_url}/state.json`);
}

// GET /holders
async function loadHolders() {
  return await safeJSON(`${backend_url}/holders`);
}

// GET /history
async function loadHistory() {
  return await safeJSON(`${backend_url}/history`);
}
// DATA LOADERS END

// RENDER HOMEPAGE START

// RENDER HOMEPAGE END