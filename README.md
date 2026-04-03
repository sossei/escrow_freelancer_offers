# Escrow Freelancer Offers

A Solana program built with Anchor that implements a decentralized escrow between clients and freelancers using native SOL.

## What it does

A **client** posts a job with a SOL budget. A **freelancer** submits a proposal. If the client accepts, the SOL is locked on-chain in a vault. After the work is done, the client either pays the freelancer (releases the SOL) or cancels (gets the SOL back).

```
Client posts job ──► Freelancer proposes ──► Client accepts (SOL locked)
                                                     │
                                          ┌──────────┴──────────┐
                                     Pay Freelancer         Cancel Job
                                    (SOL released)        (SOL returned)
```

---

## Project structure

```
escrow-challenge/
├── programs/escrow/src/lib.rs   ← Anchor program (Rust)
├── tests/escrow.ts              ← Integration tests (TypeScript)
├── Anchor.toml                  ← Anchor config (cluster, wallet, program ID)
├── Cargo.toml                   ← Rust workspace
├── package.json                 ← Test runner dependencies
└── app/                         ← Next.js frontend
    ├── components/
    │   ├── EscrowApp.tsx        ← View switcher (Client / Freelancer)
    │   ├── ClientView.tsx       ← Post jobs, manage proposals, pay/cancel
    │   └── FreelancerView.tsx   ← Browse jobs, submit proposals, track status
    └── lib/
        ├── useEscrowProgram.ts  ← Hooks that call the on-chain program
        ├── mockDb.ts            ← localStorage database (job/proposal metadata)
        └── types.ts             ← Shared TypeScript types
```

---

## On-chain accounts

The program uses three types of on-chain accounts, all derived as PDAs (Program Derived Addresses — accounts whose address is deterministically computed from seeds, with no private key).

### JobOffer
Stores a job posted by a client.

| Field | Type | Description |
|---|---|---|
| `client` | Pubkey | Wallet that created the job |
| `job_id` | u64 | Unique ID chosen by the client (used as PDA seed) |
| `title` | String | Job title (max 100 chars) |
| `description` | String | Job description (max 500 chars) |
| `amount` | u64 | Payment in lamports (1 SOL = 1,000,000,000 lamports) |
| `status` | enum | `Open` → `Accepted` → `Completed` or `Cancelled` |
| `freelancer` | Option\<Pubkey\> | Set to the freelancer's wallet when accepted |
| `bump` | u8 | PDA canonical bump |

PDA seeds: `["job_offer", client_pubkey, job_id_as_8_bytes]`

### JobProposal
Stores a freelancer's proposal for a specific job.

| Field | Type | Description |
|---|---|---|
| `job_offer` | Pubkey | The job this proposal belongs to |
| `freelancer` | Pubkey | Wallet that submitted the proposal |
| `message` | String | Proposal message (max 300 chars) |
| `status` | enum | `Pending` → `Accepted` or `Declined` |
| `bump` | u8 | PDA canonical bump |

PDA seeds: `["proposal", job_offer_pubkey, freelancer_pubkey]`

> One proposal per (freelancer, job) pair — enforced by the PDA uniqueness.

### Vault (anonymous PDA)
Holds the locked SOL. Has no data, just lamports.

PDA seeds: `["vault", job_offer_pubkey]`

---

## Program instructions

### `create_offer`
**Caller:** Client

Creates a `JobOffer` account on-chain.

```
Arguments:
  job_id      u64     Unique ID (client generates, e.g. Date.now())
  title       String  Job title
  description String  Job description
  amount      u64     SOL amount in lamports

Accounts:
  job_offer   ← new PDA (pays rent)
  client      ← signer + fee payer
  system_program
```

**Validations:**
- Title ≤ 100 chars
- Description ≤ 500 chars
- Amount > 0

---

### `offer_proposal`
**Caller:** Freelancer

Creates a `JobProposal` account on-chain for a specific job.

```
Arguments:
  message     String  Proposal message

Accounts:
  job_offer   ← existing job (must be Open)
  proposal    ← new PDA (pays rent)
  freelancer  ← signer + fee payer
  system_program
```

**Validations:**
- Job status must be `Open`
- Freelancer cannot be the same wallet as the client
- Message ≤ 300 chars
- One proposal per freelancer per job (PDA uniqueness)

---

### `accept_proposal`
**Caller:** Client

Accepts a freelancer's proposal and **locks the SOL in the vault PDA**.

```
Arguments: none

Accounts:
  job_offer   ← mut (status changes to Accepted)
  proposal    ← mut (status changes to Accepted)
  client      ← signer (SOL is debited from here)
  vault       ← mut PDA (receives the locked SOL)
  system_program
```

**Validations:**
- Job status must be `Open`
- Proposal status must be `Pending`
- Only the job's client can call this
- Proposal must belong to this job

**Effect:** Transfers `amount` lamports from `client` → `vault`. The vault holds the SOL until `complete_proposal` or `cancel_job` is called.

---

### `complete_proposal`
**Caller:** Client

Pays the freelancer — **releases the locked SOL from vault to freelancer wallet**.

```
Arguments: none

Accounts:
  job_offer   ← mut (status changes to Completed)
  client      ← signer
  freelancer  ← mut (receives SOL)
  vault       ← mut PDA (SOL debited from here)
  system_program
```

**Validations:**
- Job status must be `Accepted`
- Only the job's client can call this
- Freelancer must match `job_offer.freelancer`

**Effect:** Transfers `amount` lamports from `vault` → `freelancer`. The vault signing is done via PDA seeds (no private key needed).

---

### `cancel_job`
**Caller:** Client

Cancels the job. **If status is `Accepted`, returns the locked SOL to the client.**

```
Arguments: none

Accounts:
  job_offer   ← mut (status changes to Cancelled)
  client      ← signer (receives SOL if Accepted)
  vault       ← mut PDA
  system_program
```

**Validations:**
- Only the job's client can call this
- Job status must be `Open` or `Accepted` (cannot cancel Completed/Cancelled)

**Effect:**
- If `Open`: just marks as Cancelled (no SOL to return)
- If `Accepted`: transfers `amount` lamports from `vault` → `client`, then marks Cancelled

---

### `decline_proposal`
**Caller:** Client

Declines a freelancer's proposal. The job stays `Open` so other freelancers can still apply.

```
Arguments: none

Accounts:
  job_offer   ← (status stays Open)
  proposal    ← mut (status changes to Declined)
  client      ← signer
```

**Validations:**
- Job status must be `Open`
- Proposal status must be `Pending`
- Only the job's client can call this

---

## How to test (localnet)

### Prerequisites

Make sure you have these installed:

```bash
# Check versions
solana --version       # >= 1.18
anchor --version       # 0.32.x
rustup show            # channel should be 1.89.0
node --version         # >= 18
```

If you need to install Anchor:
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.32.1
avm use 0.32.1
```

### Step 1 — Install dependencies

```bash
# From project root
npm install
```

Expected output (normal):
```
removed 1 package, and audited 170 packages in 2s

32 packages are looking for funding
  run `npm fund` for details

6 vulnerabilities (1 low, 2 moderate, 3 high)
...
```

> The vulnerability warnings are from the test toolchain (mocha, chai, ts-mocha) and do **not** affect your program or production code. Safe to ignore for a learning project.

### Step 2 — Build the program

```bash
anchor build
```

This compiles the Rust program and generates:
- `target/deploy/escrow_freelancer_offers.so` — the compiled program
- `target/deploy/escrow_freelancer_offers-keypair.json` — the program keypair
- `target/idl/escrow_freelancer_offers.json` — the IDL (interface definition)
- `target/types/escrow_freelancer_offers.ts` — TypeScript types

### Step 3 — Sync the program ID

After building, the actual program ID is derived from the generated keypair. Sync it everywhere:

```bash
anchor keys sync
```

This updates `declare_id!` in `lib.rs` and `[programs.localnet]` in `Anchor.toml` automatically.

> If you skip this step, the tests will fail with a "program ID mismatch" error.

### Step 4 — Run the tests

```bash
anchor test
```

This command automatically:
1. Starts a local Solana validator (`solana-test-validator`)
2. Deploys the program to localnet
3. Runs all tests in `tests/escrow.ts`
4. Stops the validator

Expected output:
```
escrow_freelancer_offers
  Program ID      : <your program ID>
  Client          : <keypair pubkey>
  Freelancer      : <keypair pubkey>
  JobOffer PDA    : <pda>
  Proposal PDA    : <pda>
  Vault PDA       : <pda>

  ✔ Client can create a job offer
  ✔ Freelancer can submit a proposal
  ✔ Client cannot propose for their own job
  ✔ Client can accept a proposal (SOL locked in vault)
  ✔ Freelancer cannot call complete_proposal (only client can)
  ✔ Client can pay the freelancer (complete proposal)
  ✔ Client can cancel a job after accepting (SOL returned)
  ✔ Client can decline a proposal

  8 passing
```

### Running tests with a persistent validator

If you want to keep the validator running between runs (faster iteration):

```bash
# Terminal 1 — start the validator
solana-test-validator --reset

# Terminal 2 — deploy and test (skip validator start)
anchor test --skip-local-validator
```

---

## How to run the frontend (localnet)

### Step 1 — Copy the IDL to the app

After `anchor build`, copy the generated IDL so the frontend can import it:

```bash
cd app
npm run copy-idl
```

### Step 2 — Install app dependencies

```bash
cd app
npm install
```

### Step 3 — Configure environment

`app/.env.local` is already set up for localnet:

```env
NEXT_PUBLIC_RPC_URL=http://localhost:8899
NEXT_PUBLIC_PROGRAM_ID=<your program ID after anchor keys sync>
```

Update `NEXT_PUBLIC_PROGRAM_ID` with the actual ID printed by `anchor keys sync`.

### Step 4 — Start a local validator

```bash
# In a separate terminal
solana-test-validator --reset
```

### Step 5 — Deploy the program to localnet

```bash
anchor deploy
```

### Step 6 — Start the frontend

```bash
cd app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**Important:** Use a wallet (Phantom) configured to connect to `localhost:8899` (Localnet). You'll also need to airdrop some SOL to your wallet:

```bash
solana airdrop 2 <your-wallet-pubkey> --url localhost
```

---

## Deploying to devnet

### Step 1 — Switch cluster

In `Anchor.toml`:
```toml
[provider]
cluster = "devnet"
```

In `app/.env.local`:
```env
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
```

### Step 2 — Fund your deployer wallet

```bash
solana airdrop 2 --url devnet
```

### Step 3 — Deploy

```bash
anchor deploy --provider.cluster devnet
```

### Step 4 — Update the program ID

If the program ID changed (new deploy), run:
```bash
anchor keys sync
```

Then rebuild and redeploy:
```bash
anchor build && anchor deploy --provider.cluster devnet
```

---

## Frontend flow

### Client view ("I need someone to do")

1. **Connect wallet** (Phantom on localnet)
2. **Post a Job** — fill title, description, budget in SOL → calls `create_offer`
3. **View proposals** — see all pending proposals for each job
4. **Accept** a proposal → calls `accept_proposal` (SOL gets locked)
5. After work is done:
   - **Pay Freelancer** → calls `complete_proposal` (SOL released)
   - **Cancel Job** → calls `cancel_job` (SOL returned)

### Freelancer view ("I want to do")

1. **Connect wallet** (different wallet than the client)
2. **Browse open jobs** — all jobs posted by other wallets
3. **Submit Proposal** — write a message → calls `offer_proposal`
4. **Track your proposals** — see statuses: `pending` / `accepted` / `declined`
5. When accepted: wait for the client to release payment

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `Program ID mismatch` | `declare_id!` doesn't match the deployed keypair | Run `anchor keys sync` |
| `IDL not found` | `app/lib/escrow_freelancer_offers.json` is the placeholder | Run `anchor build` then `npm run copy-idl` from `/app` |
| `Insufficient funds` | Wallet has no SOL | Run `solana airdrop 2 <pubkey> --url localhost` |
| `JobNotOpen` | Tried to propose/accept on a non-Open job | Check job status in the UI |
| `NotJobClient` | Wrong wallet signing a client-only action | Make sure the correct wallet is connected |
| `Account not found` | Validator restarted, accounts wiped | Redeploy: `anchor deploy` |
