# state_store.py
import os
import json
import pathlib
import random
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, List, Optional

import requests

from .models import (
    Holder,
    TeamAssignment,
    SnapshotResult,
    CreatorFeeReceipt,
    PayoutPlan,
)

# ----------------------------
# Config / constants
# ----------------------------
STATE_PATH = pathlib.Path("state_store.json")

TEAMS = ["red", "purple", "blue", "yellow"]

# Env
HELIUS_API_KEY = os.getenv("HELIUS_API_KEY", "").strip()
TOKEN_MINT = os.getenv(
    "TOKEN_MINT",
    "So11111111111111111111111111111111111111112",  # fallback
).strip()

# RPC: prefer Helius if key is present, else SOLANA_RPC_URL, else mainnet-beta
DEFAULT_RPC = (
    f"https://mainnet.helius-rpc.com/?api-key={HELIUS_API_KEY}"
    if HELIUS_API_KEY
    else os.getenv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
).strip()

# SPL Token Program (v1) – used for holder snapshots
TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"


# ----------------------------
# Time / file helpers
# ----------------------------
def now_utc():
    return datetime.now(timezone.utc)


def load_state() -> Dict:
    """Load persisted state, or bootstrap a default one."""
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text())
        except Exception:
            pass

    # default bootstrap state (round in BREAK for 30s)
    default = {
        "state": {
            "roundNumber": 1,
            "phase": "BREAK",
            "breakEndsAt": (now_utc() + timedelta(seconds=30)).isoformat(),
            "prizePoolLamports": 0,
            "winner": None,
        },
        "holders": {
            "total": 0,
            "tokenAddress": TOKEN_MINT,
            "lastUpdatedISO": now_utc().isoformat(),
            "items": [],
        },
        "history": [],
        # bookkeeping for creator fees/payouts
        "pendingCreatorLamports": 0,  # collected this break; you decide when to apply
        "treasuryLamports": 0,        # your 30% + remainders
    }

    # Persist the initial bootstrap so subsequent reads return a consistent
    # `breakEndsAt` timestamp instead of bootstrapping a fresh now+30s on every
    # call (which made the frontend clock appear stuck at ~29s).
    try:
        save_state(default)
    except Exception:
        # If saving fails (permissions, read-only FS), we still return the
        # in-memory default so server can operate; frontend may continue to
        # see a changing clock in that environment.
        pass

    return default


def save_state(data: Dict) -> None:
    STATE_PATH.write_text(json.dumps(data, indent=2))


def with_state(mutator: Callable[[Dict], None]) -> Dict:
    """Load -> mutate -> save. Returns final state dict."""
    data = load_state()
    mutator(data)
    save_state(data)
    return data


# ----------------------------
# Round phase helpers
# ----------------------------
def set_break(state: Dict, seconds: int):
    """Transition to BREAK + set breakEndsAt."""
    state["phase"] = "BREAK"
    state["breakEndsAt"] = (now_utc() + timedelta(seconds=seconds)).isoformat()
    # clear any live-only fields (safe if absent)
    # state.pop("survivorCount", None)


def enter_pre_snapshot(state: Dict):
    state["phase"] = "PRE_SNAPSHOT"


def start_running(state: Dict):
    """Transition to RUNNING and bump roundNumber."""
    state["phase"] = "RUNNING"
    state["roundNumber"] = int(state.get("roundNumber", 0)) + 1
    state["breakEndsAt"] = None
    state["winner"] = None


def record_winner(data: Dict, team: str):
    """Mark winner and move to ENDED; history line is appended (front)."""
    st = data["state"]
    st["winner"] = team
    st["phase"] = "ENDED"
    data["history"].insert(0, {
        "round": int(st.get("roundNumber", 0)),
        "team": team,
        "prizeLamports": int(st.get("prizePoolLamports", 0)),
    })


# ----------------------------
# Holders & prize helpers
# ----------------------------
def set_holders(data: Dict, items: List[Holder], token_mint: str):
    data["holders"] = {
        "total": len(items),
        "tokenAddress": token_mint,
        "lastUpdatedISO": now_utc().isoformat(),
        "items": [h.dict() for h in items],
    }


def add_to_prize_pool(state: Dict, lamports: int):
    state["prizePoolLamports"] = int(state.get("prizePoolLamports", 0)) + int(lamports)


def add_to_treasury(data: Dict, lamports: int):
    data["treasuryLamports"] = int(data.get("treasuryLamports", 0)) + int(lamports)


def record_creator_fee(data: Dict, receipt: CreatorFeeReceipt):
    """
    Accumulate creator fees collected during the current break.
    If called multiple times within the same break, it keeps adding up.
    """
    cur = int(data.get("pendingCreatorLamports", 0))
    data["pendingCreatorLamports"] = cur + int(receipt.lamports)


def consume_pending_creator_lamports(data: Dict) -> int:
    """
    Read & zero-out the pending creator fees bucket.
    Use this when you move pending -> split 70/30 and add to prize/treasury.
    """
    amt = int(data.get("pendingCreatorLamports", 0))
    data["pendingCreatorLamports"] = 0
    return amt


# ----------------------------
# Team assignment (deterministic)
# ----------------------------
def seeded_shuffle(seq: list, seed: int) -> list:
    r = random.Random(seed)
    out = list(seq)
    r.shuffle(out)
    return out


def assign_teams(addresses: List[str], seed: int) -> List[Holder]:
    shuffled = seeded_shuffle(addresses, seed)
    out: List[Holder] = []
    for i, addr in enumerate(shuffled):
        team = TEAMS[i % 4]
        out.append(Holder(address=addr, team=team))  # type: ignore
    return out


# ----------------------------
# Snapshot holders (via Helius or fallback RPC)
# ----------------------------
def snapshot_holders(token_mint: Optional[str] = None, rpc_url: Optional[str] = None) -> SnapshotResult:
    """
    Fetch all SPL token accounts for the given `token_mint` and return unique
    owner addresses that hold > 0 tokens.

    Uses getProgramAccounts against the Token Program with:
      - dataSize=165 filter (SPL Token Account)
      - memcmp at offset 0 equal to token mint (account.mint)

    Works on Helius endpoints and standard RPC.
    """
    tm = (token_mint or TOKEN_MINT).strip()
    url = (rpc_url or DEFAULT_RPC).strip()

    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getProgramAccounts",
        "params": [
            TOKEN_PROGRAM_ID,
            {
                "encoding": "jsonParsed",
                "filters": [
                    {"dataSize": 165},
                    {"memcmp": {"offset": 0, "bytes": tm}},
                ],
            },
        ],
    }

    try:
        resp = requests.post(url, json=body, timeout=60)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        # On error, return empty snapshot so caller can decide how to proceed
        return SnapshotResult(tokenAddress=tm, holders=[])

    result = data.get("result", [])
    owners: List[str] = []
    seen = set()

    for acc in result:
        parsed = acc.get("account", {}).get("data", {}).get("parsed", {})
        info = parsed.get("info", {})
        owner = info.get("owner")
        token_amount = info.get("tokenAmount", {})
        # Prefer uiAmount, fallback to string "amount"
        ui_amt = token_amount.get("uiAmount")
        raw_amt = token_amount.get("amount")
        has_balance = False
        if isinstance(ui_amt, (int, float)) and ui_amt > 0:
            has_balance = True
        else:
            try:
                has_balance = int(raw_amt) > 0
            except Exception:
                has_balance = False

        if owner and has_balance and owner not in seen:
            seen.add(owner)
            owners.append(owner)

    return SnapshotResult(tokenAddress=tm, holders=owners)


def fetch_and_assign_teams(
    token_mint: Optional[str],
    seed: int,
    rpc_url: Optional[str] = None,
) -> List[Holder]:
    """
    Fetch a real snapshot of holders (via Helius if configured) and deterministically
    assign them into 4 teams using the given seed.
    """
    snap = snapshot_holders(token_mint or TOKEN_MINT, rpc_url=rpc_url or DEFAULT_RPC)
    addresses = snap.holders

    # If snapshot fails or returns empty, keep a small demo pool instead of failing the round.
    if not addresses:
        addresses = [f"Hldr{i:03d}...xyz" for i in range(1, 81)]

    return assign_teams(addresses, seed)