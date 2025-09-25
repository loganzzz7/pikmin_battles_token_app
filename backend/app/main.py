import os
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .models import Holder, HoldersResponse, HistoryItem, RoundState, WinnerPayload
from .state_store import (
    load_state,
    save_state,
    set_break,
    enter_pre_snapshot,
    start_running,
    record_winner,
    set_holders,
    fetch_and_assign_teams,
)

# ------------ Config ------------
BREAK_SECONDS = int(os.getenv("BREAK_SECONDS", "30"))
PRE_SNAPSHOT_LEEWAY = 5
TOKEN_MINT = os.getenv("TOKEN_MINT", "So11111111111111111111111111111111111111112")

ALLOWED_ORIGINS = os.getenv(
    "FRONTEND_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000"
).split(",")

TEAMS = ["red", "purple", "blue", "yellow"]

app = FastAPI(title="Pikmin Battles API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ------------ Utils ------------
def now_utc():
    return datetime.now(timezone.utc)

def parse_iso(s: str) -> datetime:
    if not s:
        return now_utc()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

# ------------ Endpoints ------------
@app.get("/healthz")
def healthz():
    return {"ok": True}

@app.get("/state.json", response_model=RoundState)
def get_state():
    data = load_state()
    st = data["state"]
    # compute secondsLeft for BREAK/PRE_SNAPSHOT
    secs_left = None
    if st.get("phase") in ("BREAK", "PRE_SNAPSHOT") and st.get("breakEndsAt"):
        from datetime import datetime, timezone
        end = datetime.fromisoformat(st["breakEndsAt"].replace("Z", "+00:00"))
        secs_left = max(0, int((end - datetime.now(timezone.utc)).total_seconds()))
    st["secondsLeft"] = secs_left
    return st

@app.get("/holders", response_model=HoldersResponse)
def get_holders():
    data = load_state()
    return data["holders"]

@app.get("/history", response_model=List[HistoryItem])
def get_history():
    data = load_state()
    return data["history"]

@app.post("/winner")
def post_winner(p: WinnerPayload):
    data = load_state()
    state = data["state"]

    # Only accept during RUNNING, valid team, and matching round
    if state.get("phase") != "RUNNING":
        return {"ok": False, "reason": "not running"}
    if p.team not in TEAMS:
        return {"ok": False, "reason": "bad team"}
    if int(state.get("roundNumber", 0)) != int(p.round):
        return {"ok": False, "reason": "round mismatch"}

    # Record winner and flip to ENDED; loop will send us to BREAK next tick
    record_winner(data, p.team)
    save_state(data)
    return {"ok": True}

# ------------ Round loop ------------
@app.on_event("startup")
async def _start_round_loop():
    asyncio.create_task(round_loop())

async def round_loop():
    while True:
        data = load_state()
        state = data["state"]
        phase = state.get("phase", "BREAK")

        # Compute secs_left only in BREAK / PRE_SNAPSHOT
        secs_left = None
        if phase in ("BREAK", "PRE_SNAPSHOT"):
            be = state.get("breakEndsAt")
            if not be:
                # ensure a 30s countdown exists when entering BREAK
                set_break(state, BREAK_SECONDS)
                save_state(data)
            else:
                secs_left = int((parse_iso(be) - now_utc()).total_seconds())
                secs_left = max(0, secs_left)

        # ---- BREAK ----
        if phase == "BREAK":
            # Move to PRE_SNAPSHOT once per break at T-5s
            if secs_left is not None and secs_left <= PRE_SNAPSHOT_LEEWAY:
                enter_pre_snapshot(state)

                # Real snapshot + team assignment
                next_round = int(state.get("roundNumber", 0)) + 1
                assigned: List[Holder] = fetch_and_assign_teams(
                    token_mint=TOKEN_MINT,   # uses HELIUS_API_KEY inside state_store
                    seed=next_round * 1337
                )
                set_holders(data, assigned, token_mint=TOKEN_MINT)
                save_state(data)

        # ---- PRE_SNAPSHOT ----
        elif phase == "PRE_SNAPSHOT":
            # Fall through to RUNNING when timer hits 0 (handled below)
            pass

        # Start RUNNING when BREAK/PRE_SNAPSHOT timer hits 0
        if phase in ("BREAK", "PRE_SNAPSHOT") and secs_left == 0:
            start_running(state)     # sets phase=RUNNING, ++roundNumber, clears breakEndsAt
            save_state(data)

        # ---- RUNNING ----
        elif phase == "RUNNING":
            # FE determines the winner and POSTs /winner
            pass

        # ---- ENDED ----
        elif phase == "ENDED":
            # Back to BREAK with a fresh 30s timer
            set_break(state, BREAK_SECONDS)
            save_state(data)

        await asyncio.sleep(1)