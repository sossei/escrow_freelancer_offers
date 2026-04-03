"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ClientView } from "./ClientView";
import { FreelancerView } from "./FreelancerView";

type View = "client" | "freelancer";

export function EscrowApp() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [view, setView] = useState<View>("client");
  const [airdropping, setAirdropping] = useState(false);
  const [airdropMsg, setAirdropMsg] = useState("");
  const [balance, setBalance] = useState<number | null>(null);

  const fetchBalance = useCallback(async () => {
    if (!publicKey) return;
    const lamports = await connection.getBalance(publicKey);
    setBalance(lamports / LAMPORTS_PER_SOL);
  }, [publicKey, connection]);

  // Fetch on mount and every 5 seconds
  useEffect(() => {
    fetchBalance();
    const id = setInterval(fetchBalance, 5000);
    return () => clearInterval(id);
  }, [fetchBalance]);

  async function handleAirdrop() {
    if (!publicKey) return;
    setAirdropping(true);
    setAirdropMsg("");
    try {
      const sig = await connection.requestAirdrop(publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
      setAirdropMsg("2 SOL airdropped!");
      setTimeout(() => setAirdropMsg(""), 3000);
      fetchBalance();
    } catch {
      setAirdropMsg("Airdrop failed — only works on localnet/devnet");
      setTimeout(() => setAirdropMsg(""), 4000);
    } finally {
      setAirdropping(false);
    }
  }

  if (!publicKey) {
    return (
      <div className="container">
        <div className="connect-prompt">
          <h2>Escrow Freelancer Offers</h2>
          <p>
            Connect your Phantom wallet to get started as a client or
            freelancer.
          </p>
          <WalletMultiButton />
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      {/* Header */}
      <div className="header">
        <h1>Escrow Freelancer Offers</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Balance pill */}
          <div style={{
            background: "var(--bg-input)",
            border: "1px solid var(--border)",
            borderRadius: 20,
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 600,
            color: balance !== null && balance < 0.01 ? "var(--danger)" : "var(--success)",
            minWidth: 90,
            textAlign: "center",
          }}>
            {balance === null ? "…" : `${balance.toFixed(3)} SOL`}
          </div>

          {airdropMsg && (
            <span style={{ fontSize: 12, color: "var(--success)" }}>
              {airdropMsg}
            </span>
          )}
          <button
            className="btn btn-outline"
            onClick={handleAirdrop}
            disabled={airdropping}
            title="Airdrop 2 SOL to your wallet (localnet/devnet only)"
          >
            {airdropping ? "Airdropping…" : "Airdrop 2 SOL"}
          </button>
          <WalletMultiButton />
        </div>
      </div>

      {/* View toggle */}
      <div className="view-toggle">
        <button
          className={`toggle-btn ${view === "client" ? "active" : ""}`}
          onClick={() => setView("client")}
        >
          I need someone to do
        </button>
        <button
          className={`toggle-btn ${view === "freelancer" ? "active" : ""}`}
          onClick={() => setView("freelancer")}
        >
          I want to do
        </button>
      </div>

      {/* Active view */}
      {view === "client" ? <ClientView /> : <FreelancerView />}
    </div>
  );
}
