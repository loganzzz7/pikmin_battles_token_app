from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict

TeamName = Literal["red", "purple", "blue", "yellow"]

class Holder(BaseModel):
    address: str
    team: TeamName

class HoldersResponse(BaseModel):
    total: int
    tokenAddress: str
    lastUpdatedISO: str
    items: List[Holder]

class HistoryItem(BaseModel):
    round: int
    team: TeamName
    prizeLamports: int = Field(0, description="Lamports; FE converts to SOL")

class RoundState(BaseModel):
    roundNumber: int
    phase: Literal["BREAK","PRE_SNAPSHOT","RUNNING","ENDED"]
    breakEndsAt: Optional[str] = None
    prizePoolLamports: int
    winner: Optional[TeamName] = None
    secondsLeft: Optional[int] = None

class WinnerPayload(BaseModel):
    round: int
    team: TeamName

# --- new internal models ---
class SnapshotResult(BaseModel):
    tokenAddress: str
    holders: List[str]  # plain addresses

class TeamAssignment(BaseModel):
    items: List[Holder]  # address + team

class CreatorFeeReceipt(BaseModel):
    lamports: int
    tx_signature: Optional[str] = None
    pool: Optional[str] = None
    mint: Optional[str] = None

class PayoutPlan(BaseModel):
    round: int
    team: TeamName
    recipients: List[str]
    totalLamports: int