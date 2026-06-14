<div align="center">
  <img src="docs/icon-animated.svg" alt="Summon Logo" width="120">

  <h1>Summon 👤</h1>
  <p><em>Human-in-the-loop sign-off agent — any agent hires Summon to get a human Approve/Reject via Telegram</em></p>
  <img src="docs/readme-hero-animated.svg" alt="Summon" width="100%">

  <br/>

  [![Live Demo](https://img.shields.io/badge/🚀_Live-Demo-06b6d4?style=for-the-badge)](https://mock.croo.network)
  [![Built for CROO Hackathon](https://img.shields.io/badge/DoraHacks-CROO_Hackathon_2026-8b5cf6?style=for-the-badge)](https://dorahacks.io/hackathon/croo-hackathon)

  <br/>

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
  ![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
  [![CI](https://github.com/edycutjong/summon/actions/workflows/ci.yml/badge.svg)](https://github.com/edycutjong/summon/actions/workflows/ci.yml)

</div>

---

## 📸 See it in Action

<div align="center">
  <img src="docs/see-in-action.png" alt="Summon Demo" width="100%">
</div>

> **The Human-in-the-Loop Workflow.** Agent triggers Summon → Summon sends Telegram message → Human taps Approve/Reject → Summon returns decision to agent.

---

## 💡 The Problem & Solution
Fully autonomous agents can make costly mistakes. Before executing a high-stakes transaction, agents need a reliable way to halt and ask for human permission.
**Summon** solves this by providing a universal Human-in-the-loop agent that bridges on-chain AI with real-time human communication via Telegram.

**Key Features:**
- ⚡ **Instant Notification:** Pushes agent requests directly to your Telegram.
- 🔒 **Secure Sign-off:** Only authorized Telegram users can approve or reject.
- 🎨 **Seamless Integration:** Any agent in the Constellation A2A ecosystem can hire Summon to act as its human arbiter.

## 🌌 The Constellation — On-Chain A2A Graph

Summon is the constellation's **human arbiter**: any agent can hire it on-chain to put a real person in the loop, escrow-backed with an SLA auto-refund if no one responds in time. "An agent pays a human for a yes/no decision, with on-chain escrow" simply doesn't exist on a normal API marketplace.

```mermaid
graph LR
    User([Any Agent / User]) -->|hires for sign-off| S[Summon 👤]
    S -->|Approve / Reject| H((Human via Telegram))
    M[Maestro 🎼] -->|escalates low-confidence work| S
    G[Gauntlet 🧤] -.->|certifies| S
    classDef hot fill:#F59E0B,stroke:#111,color:#111,font-weight:bold;
    class S hot;
```

- **SLA safety:** if the human doesn't tap in time, Summon cancels the request and the buyer's escrow is cleanly refunded — no stuck funds.
- **Adoption wedge:** the [Demo Insurance snippet](#️-hackathon-demo-insurance-copy-paste-integration) lets any hackathon bot add a human fallback in a few lines.

## 🔗 Live Run Log — On-Chain Proof (Base Mainnet)

Real CAP orders Summon fulfilled as a **provider** — an agent paid for a human decision.

**Total real CAP orders: _0_** · _last updated: 2026-06-__

| # | Date | Counterparty (requester) | Amount (USDC) | Order ID | Tx (BaseScan) | Decision |
|---|------|--------------------------|---------------|----------|---------------|----------|
| 1 | _2026-06-__ | _Maestro / external bot_ | _0.00_ | `_ord_…_` | [0x…](https://basescan.org/tx/0x…) | ✅ Approved / ❌ Rejected |

> Order IDs + the buyer's pay tx are in the provider logs and the CROO dashboard. Delete this note once populated.

## 🏗️ Architecture & Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js (TypeScript) |
| **Messaging** | Telegram Bot API |
| **Ecosystem** | Constellation A2A (croo-core) |
| **Testing** | Vitest |

## 🚀 Getting Started

### Prerequisites
- Node.js ≥ 20
- npm
- A Telegram Bot Token (from @BotFather)

### Installation
1. Clone: `git clone https://github.com/edycutjong/summon.git`
2. Install: `npm install`
3. Configure: `cp .env.example .env.local` and fill in `CROO_SDK_KEY`, `SUMMON_SERVICE_ID`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID` (or set `CROO_MOCK=true` for offline mode)
4. Run: `npm run dev`

### ▶️ Run it now — offline mock mode (no wallet, no USDC)
```bash
npm install
CROO_MOCK=true npm run dev   # boots the provider with no on-chain calls
```
For the full human round-trip, set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` and run `npm run dev` — taps on the Telegram inline buttons resolve the order.

> **For Judges:** Skip account creation! You can test the bot interaction by messaging our live test bot at @SummonTestBot.

## 🧪 Testing & CI

**4-stage pipeline:** Quality → Security → Build → Deploy Gate

```bash
# ── Code Quality ────────────────────────────
npm run lint          # ESLint
npm run typecheck     # TypeScript check
npm run test          # Run tests
npm run test:coverage # Coverage report
npm run ci            # Full quality gate

# ── Security ────────────────────────────────
make security-scan    # npm audit + license check
```

| Layer | Tool | Status |
|---|---|---|
| Code Quality | ESLint + TypeScript | ✅ |
| Unit Testing | Vitest | ✅ |
| Security (SAST) | CodeQL | ✅ |
| Security (SCA) | Dependabot + npm audit | ✅ |
| Secret Scanning | TruffleHog | ✅ |

## 📁 Project Structure
```text
dorahacks-croo-summon/
├── docs/              # README assets (screenshots)
├── src/               # Application source code
├── scripts/           # Build and run scripts
├── __tests__/         # Vitest test suites
├── .env.example       # Environment template
├── .github/           # CI workflows
└── README.md          # You are here
```

## 🚢 Deploy
Containerized for any PaaS. Summon is a background **worker** (Telegram polling + CROO WebSocket — no inbound port):
```bash
docker build -t summon .
docker run --env-file .env.local summon
```

## 📄 License
[MIT](LICENSE) © 2026 Edy Cu

## 🙏 Acknowledgments
Built for the DoraHacks CROO Hackathon 2026.

## 🛡️ Hackathon "Demo Insurance" (Copy-Paste Integration)

**Terrified your autonomous DeFi or Research bot might hallucinate or crash during the live judge demo?** 

Add this 5-line `Summon` snippet to your error-catching block. If your bot hits a wall, it autonomously hires my agent for $0.01 USDC. I will get pinged on Telegram, manually review the data, and tap 'Approve/Override'. 

Your agent recovers gracefully, you get a bulletproof demo showing **A2A resilience**, and we both satisfy the Hackathon's **Anti-Sybil counterparty rule**.

```typescript
import { hire } from "@edycutjong/croo-core";

// Drop this in your catch block or low-confidence branch.
// hire() runs the full requester flow: negotiate → pay → wait for delivery.
const { delivery } = await hire<{ approved: boolean }>(client, {
  serviceId: process.env.SUMMON_SERVICE_ID!, // DM me in Discord for my ID!
  requirement: {
    prompt: "Demo emergency: Bot confidence low. Proceed with execution?",
    context: JSON.stringify(failedPayload),
  },
  maxPrice: 1.0, // max USDC you're willing to spend
});

if (delivery.approved) {
  // Proceed safely based on the human verdict!
}
```
