# claim_rewards.py
import os
import json
import requests
from typing import Optional

from solders.transaction import VersionedTransaction
from solders.keypair import Keypair
from solders.commitment_config import CommitmentLevel
from solders.rpc.requests import SendVersionedTransaction
from solders.rpc.config import RpcSendTransactionConfig

PUMPPORTAL_LOCAL_URL = "https://pumpportal.fun/api/trade-local"

def _env(name: str, default: str = "") -> str:
    v = os.getenv(name, default)
    if v is None:
        v = default
    return v.strip()

def collect_creator_fee_local(
    wallet_address: Optional[str] = None,
    wallet_private_key: Optional[str] = None,
    rpc_url: Optional[str] = None,
    priority_fee: Optional[float] = None,
) -> str:
    """
    Build via PumpPortal local endpoint, sign with local key, and send to your RPC.
    Returns the transaction signature.
    """
    wallet_address = wallet_address or _env("WALLET_ADDRESS")
    wallet_private_key = wallet_private_key or _env("WALLET_PRIVATE_KEY")
    rpc_url = (rpc_url or _env("SOLANA_RPC_URL") or "https://api.mainnet-beta.solana.com").strip()
    priority_fee = float(priority_fee if priority_fee is not None else (_env("PRIORITY_FEE") or 0.000001))

    if not wallet_address:
        raise ValueError("WALLET_ADDRESS is required (base58 public key).")
    if not wallet_private_key:
        raise ValueError("WALLET_PRIVATE_KEY is required (base58 private key).")

    # 1) Ask PumpPortal for a prebuilt local transaction (binary)
    try:
        resp = requests.post(
            url=PUMPPORTAL_LOCAL_URL,
            data={
                "publicKey": wallet_address,
                "action": "collectCreatorFee",
                "priorityFee": priority_fee,
            },
            timeout=60,
        )
    except Exception as e:
        raise RuntimeError(f"Failed to reach PumpPortal: {e}")

    if resp.status_code != 200:
        # PumpPortal often returns text on error; include body for debugging
        raise RuntimeError(f"PumpPortal error {resp.status_code}: {resp.text}")

    # 2) Deserialize and sign locally
    try:
        unsigned_bytes = resp.content  # raw bytes of VersionedTransaction
        tx = VersionedTransaction.deserialize(unsigned_bytes)
    except Exception as e:
        # Some older examples build VersionedTransaction from message; deserialize works with bytes directly
        raise RuntimeError(f"Failed to deserialize unsigned transaction: {e}")

    try:
        signer = Keypair.from_base58_string(wallet_private_key)
        tx.sign([signer])
    except Exception as e:
        raise RuntimeError(f"Failed to sign transaction with provided private key: {e}")

    # 3) Send to your RPC
    try:
        commitment = CommitmentLevel.Confirmed
        cfg = RpcSendTransactionConfig(preflight_commitment=commitment)
        send_req = SendVersionedTransaction(tx, cfg)
        send_json = send_req.to_json()

        send_resp = requests.post(
            url=rpc_url,
            headers={"Content-Type": "application/json"},
            data=send_json,
            timeout=60,
        )
        send_resp.raise_for_status()
        send_data = send_resp.json()
    except Exception as e:
        raise RuntimeError(f"Failed to send transaction to RPC: {e}")

    # 4) Parse signature or surface RPC error
    if "error" in send_data and send_data["error"]:
        raise RuntimeError(f"RPC error: {json.dumps(send_data['error'])}")

    sig = send_data.get("result")
    if not sig:
        raise RuntimeError(f"RPC returned no signature: {send_data}")

    return sig


if __name__ == "__main__":
    try:
        sig = collect_creator_fee_local()
        print(f"Transaction: https://solscan.io/tx/{sig}")
    except Exception as e:
        print(f"[claim_rewards] Error: {e}")