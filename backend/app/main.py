from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timedelta, timezone
import os, json, pathlib

ALLOWED_ORIGINS = os.getenv(
    "FRONTEND_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000"
).split(",")
STATE_PATH = pathlib.Path(os.getenv("STATE_PATH", "state_store.json"))

app = FastAPI(title="Pikmin Battles API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS],
    allow_methods=["GET", "OPTIONS"],  # allow preflight just in case
    allow_headers=["*"],
)

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
    survivorCount: Optional[int] = None

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
            "survivorCount": None,
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