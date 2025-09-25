from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timedelta, timezone
import os, json, pathlib
# --- game loop logic START ---
import asyncio
import random

# Durations (seconds)
BREAK_SECONDS = int(os.getenv("BREAK_SECONDS", "30"))
PRE_SNAPSHOT_LEEWAY = 5
RUN_SECONDS = int(os.getenv("RUN_SECONDS", "0"))

def parse_iso(s: str) -> datetime:
    """Parse ISO8601 ('...Z' or with offset) to aware datetime (UTC)."""
    if not s:
        return now_utc()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def set_break_end(state: dict, seconds: int = BREAK_SECONDS) -> None:
    state["breakEndsAt"] = (now_utc() + timedelta(seconds=seconds)).isoformat()

def seeded_shuffle(seq: list, seed: int) -> list:
    r = random.Random(seed)
    out = list(seq)
    r.shuffle(out)
    return out

def assign_teams(addresses: list, seed: int) -> dict:
    """Deterministically shuffle holders and split evenly into 4 teams."""
    shuffled = seeded_shuffle(addresses, seed)
    teams = { "red": [], "purple": [], "blue": [], "yellow": [] }
    for i, w in enumerate(shuffled):
        (teams["red"] if i % 4 == 0 else
         teams["purple"] if i % 4 == 1 else
         teams["blue"] if i % 4 == 2 else
         teams["yellow"]).append(w)
    return teams
# --- game loop logic END ---

ALLOWED_ORIGINS = os.getenv(
    "FRONTEND_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000"
).split(",")
STATE_PATH = pathlib.Path(os.getenv("STATE_PATH", "state_store.json"))

app = FastAPI(title="Pikmin Battles API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS],
    allow_methods=["GET", "POST", "OPTIONS"],  # allow preflight just in case
    allow_headers=["*"],
)

TEAMS = ["red", "purple", "blue", "yellow"]

class WinnerPayload(BaseModel):
    round: int
    team: str

@app.post("/winner")
def post_winner(p: WinnerPayload):
    data = load_state()
    state = data["state"]
    history = data["history"]

    # Only accept during RUNNING, valid team, and matching round
    if state.get("phase") != "RUNNING":
        return {"ok": False, "reason": "not running"}
    if p.team not in TEAMS:
        return {"ok": False, "reason": "bad team"}
    if int(state.get("roundNumber", 0)) != int(p.round):
        return {"ok": False, "reason": "round mismatch"}

    # End the round; round_loop will flip to BREAK next tick
    state["winner"] = p.team
    state["phase"] = "ENDED"
    history.insert(0, {
        "round": int(state.get("roundNumber", 0)),
        "team": p.team,
        "prizeLamports": int(state.get("prizePoolLamports", 0)),
    })
    save_state(data)
    return {"ok": True}

# ---------- Schemas ----------
class Holder(BaseModel):
    address: str
    team: str  # red|purple|blue|yellow

class HoldersResponse(BaseModel):
    total: int
    tokenAddress: str
    lastUpdatedISO: str
    items: List[Holder]

class HistoryItem(BaseModel):
    round: int
    team: str
    prizeLamports: int = Field(0, description="Use lamports; FE converts to SOL")

class RoundState(BaseModel):
    roundNumber: int
    phase: str  # "BREAK" | "PRE_SNAPSHOT" | "RUNNING" | "ENDED"
    breakEndsAt: Optional[str] = None  # ISO string
    prizePoolLamports: int
    # survivorCount: Optional[int] = None

# ---------- State helpers ----------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def load_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text())
        except Exception:
            pass
    # default bootstrap state (round in BREAK for 30s)
    return {
        "state": {
            "roundNumber": 1,
            "phase": "BREAK",
            "breakEndsAt": (now_utc() + timedelta(seconds=30)).isoformat(),
            "prizePoolLamports": 0,
            # "survivorCount": None,
        },
        "holders": {
            "total": 0,
            "tokenAddress": os.getenv("TOKEN_MINT", "So11111111111111111111111111111111111111112"),
            "lastUpdatedISO": now_utc().isoformat(),
            "items": [],
        },
        "history": [],
    }

def save_state(data: dict) -> None:
    STATE_PATH.write_text(json.dumps(data, indent=2))

# ---------- Endpoints ----------
@app.get("/healthz")
def healthz():
    return {"ok": True}

@app.get("/state.json", response_model=RoundState)
def get_state():
    data = load_state()
    return data["state"]

@app.get("/holders", response_model=HoldersResponse)
def get_holders():
    data = load_state()
    return data["holders"]

@app.get("/history", response_model=List[HistoryItem])
def get_history():
    data = load_state()
    return data["history"]

# ---------- round loop logic (background) ----------
# BREAK (30s) → PRE_SNAPSHOT (T–5s) → RUNNING → decide a winner → ENDED → back to BREAK.
@app.on_event("startup")
async def _start_round_loop():
    # Kick off background state machine
    asyncio.create_task(round_loop())


async def round_loop():
    running_started_at: Optional[datetime] = None

    while True:
        data = load_state()
        state = data["state"]
        holders = data["holders"]
        history = data["history"]

        phase = state.get("phase", "BREAK")

        # Compute secs_left (works for BREAK and PRE_SNAPSHOT; ignore otherwise)
        secs_left = None
        if phase in ("BREAK", "PRE_SNAPSHOT"):
            if not state.get("breakEndsAt"):
                set_break_end(state, BREAK_SECONDS)
                save_state(data)
            secs_left = int((parse_iso(state["breakEndsAt"]) - now_utc()).total_seconds())
            secs_left = max(0, secs_left)

        # ---- BREAK ----
        if phase == "BREAK":
            # Flip to PRE_SNAPSHOT at T-5s (once)
            if secs_left is not None and secs_left <= PRE_SNAPSHOT_LEEWAY:
                state["phase"] = "PRE_SNAPSHOT"

                # --- FAKE SNAPSHOT (replace later) ---
                existing = [it["address"] for it in holders.get("items", [])]
                if not existing:
                    existing = [f"Hldr{i:03d}...xyz" for i in range(1, 81)]  # ~80 holders

                next_round = int(state.get("roundNumber", 0)) + 1
                teams = assign_teams(existing, seed=next_round * 1337)
                items = []
                for tname in TEAMS:
                    items.extend({"address": addr, "team": tname} for addr in teams[tname])

                data["holders"] = {
                    "total": len(existing),
                    "tokenAddress": os.getenv("TOKEN_MINT", "So11111111111111111111111111111111111111112"),
                    "lastUpdatedISO": now_utc().isoformat(),
                    "items": items,
                }
                # state["survivorCount"] = len(existing)
                save_state(data)

        # ---- PRE_SNAPSHOT ----
        elif phase == "PRE_SNAPSHOT":
            # nothing special here; we fall through to RUNNING when time hits 0
            pass

        # Start RUNNING when the countdown hits 0 (works for BREAK and PRE_SNAPSHOT)
        if phase in ("BREAK", "PRE_SNAPSHOT") and secs_left == 0:
            state["phase"] = "RUNNING"
            state["roundNumber"] = int(state.get("roundNumber", 0)) + 1
            state["breakEndsAt"] = None
            state.pop("winner", None)
            running_started_at = now_utc()
            save_state(data)

        # ---- RUNNING ----
        elif phase == "RUNNING":
            pass
            # # If you want a demo timeout, set RUN_SECONDS>0 via env.
            # if running_started_at is None:
            #     running_started_at = now_utc()

            # if RUN_SECONDS > 0:
            #     elapsed = (now_utc() - running_started_at).total_seconds()
            #     if elapsed >= RUN_SECONDS:
            #         rnd = int(state.get("roundNumber", 1))
            #         winner = TEAMS[(rnd - 1) % len(TEAMS)]
            #         state["winner"] = winner
            #         state["phase"] = "ENDED"
            #         history.insert(0, {
            #             "round": rnd,
            #             "team": winner,
            #             "prizeLamports": int(state.get("prizePoolLamports", 0)),
            #         })
            #         running_started_at = None
            #         save_state(data)

        # ---- ENDED ----
        elif phase == "ENDED":
            state["phase"] = "BREAK"
            set_break_end(state, BREAK_SECONDS)
            save_state(data)

        await asyncio.sleep(1)