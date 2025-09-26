# Pikmin Battles Token App - Deployment Guide

## Prerequisites

### Required Environment Variables

Set these environment variables in your deployment platform (Heroku, Railway, etc.):

#### Core Configuration
- `WALLET_ADDRESS` - Your Solana wallet public key (base58)
- `WALLET_PRIVATE_KEY` - Your Solana wallet private key (base58)
- `TOKEN_MINT` - The token mint address for your token
- `HELIUS_API_KEY` - Helius API key for holder snapshots (optional but recommended)

#### Optional Configuration
- `SOLANA_RPC_URL` - Custom RPC endpoint (defaults to mainnet-beta)
- `PRIORITY_FEE` - Transaction priority fee in SOL (default: 0.000001)
- `BREAK_SECONDS` - Break duration between rounds in seconds (default: 30)
- `FRONTEND_ORIGINS` - Comma-separated list of allowed frontend origins (default: localhost)

## File Structure
```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app with round loop
│   ├── models.py            # Pydantic models
│   ├── state_store.py       # State management
│   └── services/
│       ├── claim_reward.py  # Creator fee collection
│       └── distribute_prize.py # Prize distribution
├── requirements.txt         # Python dependencies
├── Procfile                # Heroku process file
└── state_store.json        # Persistent state (auto-created)
```

## How It Works

### Round Lifecycle
1. **BREAK** (30s) - Collect creator fees, prepare for next round
2. **PRE_SNAPSHOT** (5s) - Take snapshot of token holders, assign teams
3. **RUNNING** - Game is active, frontend can submit winners
4. **ENDED** - Distribute prizes to winning team, return to BREAK

### Key Features
- **Automatic Prize Distribution**: Winners get equal shares of the prize pool
- **Deterministic Team Assignment**: Same seed always produces same teams
- **Error Handling**: Failed distributions don't block the round loop
- **State Persistence**: Game state survives server restarts

## Security Notes

⚠️ **IMPORTANT**: 
- Never commit your private keys to version control
- Use environment variables for all sensitive data
- Consider using a dedicated wallet for the app
- Monitor transaction logs for any issues

## Monitoring

The app logs important events:
- Prize distribution transactions with Solscan links
- Round phase transitions
- Error messages for debugging

## Testing

To test locally:`
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The app will be available at `http://localhost:8000` with automatic API docs at `http://localhost:8000/docs`.
