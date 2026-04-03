"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useEscrowProgram, deriveJobOfferPda } from "../lib/useEscrowProgram";
import {
  getOffers,
  saveOffer,
  updateOfferStatus,
  getProposalsForJob,
  updateProposalStatus,
} from "../lib/mockDb";
import type { JobOffer, JobProposal } from "../lib/types";

type TxInfo = { feeLamports: number; note: string };

export function ClientView({ onTxDone }: { onTxDone?: () => void }) {
  const { publicKey } = useWallet();
  const escrow = useEscrowProgram();

  const [offers, setOffers] = useState<JobOffer[]>([]);
  const [proposalsMap, setProposalsMap] = useState<
    Record<string, JobProposal[]>
  >({});

  // Create offer form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amountSol, setAmountSol] = useState("");
  const [creating, setCreating] = useState(false);
  const [txLoading, setTxLoading] = useState<string | null>(null); // loading per offer id
  const [error, setError] = useState("");
  const [lastTx, setLastTx] = useState<TxInfo | null>(null);

  const walletKey = publicKey?.toBase58() ?? "";

  // Reload from localStorage
  function reload() {
    const all = getOffers().filter((o) => o.client === walletKey);
    setOffers(all.sort((a, b) => b.createdAt - a.createdAt));

    const map: Record<string, JobProposal[]> = {};
    all.forEach((o) => {
      map[o.id] = getProposalsForJob(o.id);
    });
    setProposalsMap(map);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletKey]);

  // ── Create offer ──────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey) return;
    setError("");
    setCreating(true);

    try {
      const sol = parseFloat(amountSol);
      if (!title.trim() || !description.trim() || isNaN(sol) || sol <= 0) {
        setError("Please fill all fields with valid values.");
        return;
      }

      const jobId = BigInt(Date.now());
      const jobOfferPda = deriveJobOfferPda(publicKey, jobId);

      // Call on-chain
      const { feeLamports } = await escrow.createOffer({
        jobId,
        title: title.trim(),
        description: description.trim(),
        amountSol: sol,
      });

      setLastTx({ feeLamports, note: "Created JobOffer account (rent deposited on-chain)" });
      onTxDone?.();

      // Persist locally
      const newOffer: JobOffer = {
        id: jobOfferPda.toBase58(), // use PDA as local ID
        jobId,
        pdaAddress: jobOfferPda.toBase58(),
        client: walletKey,
        title: title.trim(),
        description: description.trim(),
        amount: Math.floor(sol * LAMPORTS_PER_SOL),
        status: "open",
        createdAt: Date.now(),
      };
      saveOffer(newOffer);

      setTitle("");
      setDescription("");
      setAmountSol("");
      reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  // ── Accept proposal ───────────────────────────────────────────────────────
  async function handleAccept(offer: JobOffer, proposal: JobProposal) {
    setTxLoading(`accept-${proposal.id}`);
    setError("");
    try {
      const { feeLamports } = await escrow.acceptProposal({
        jobOfferPda: offer.pdaAddress,
        freelancerPubkey: proposal.freelancer,
      });
      setLastTx({ feeLamports, note: "Created Vault account + locked SOL in escrow (rent deposited)" });
      onTxDone?.();
      updateOfferStatus(offer.id, "accepted", proposal.freelancer);
      updateProposalStatus(proposal.id, "accepted");
      reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTxLoading(null);
    }
  }

  // ── Decline proposal ──────────────────────────────────────────────────────
  async function handleDecline(offer: JobOffer, proposal: JobProposal) {
    setTxLoading(`decline-${proposal.id}`);
    setError("");
    try {
      const { feeLamports } = await escrow.declineProposal({
        jobOfferPda: offer.pdaAddress,
        freelancerPubkey: proposal.freelancer,
      });
      setLastTx({ feeLamports, note: "Proposal account closed (rent returned to freelancer)" });
      onTxDone?.();
      updateProposalStatus(proposal.id, "declined");
      reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTxLoading(null);
    }
  }

  // ── Pay freelancer ────────────────────────────────────────────────────────
  async function handlePay(offer: JobOffer) {
    if (!offer.acceptedFreelancer) return;
    setTxLoading(`pay-${offer.id}`);
    setError("");
    try {
      const { feeLamports } = await escrow.completeProposal({
        jobOfferPda: offer.pdaAddress,
        freelancerPubkey: offer.acceptedFreelancer,
      });
      setLastTx({ feeLamports, note: "Vault closed — SOL sent to freelancer (vault rent reclaimed)" });
      onTxDone?.();
      updateOfferStatus(offer.id, "completed");
      reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTxLoading(null);
    }
  }

  // ── Cancel job ────────────────────────────────────────────────────────────
  async function handleCancel(offer: JobOffer) {
    setTxLoading(`cancel-${offer.id}`);
    setError("");
    try {
      const { feeLamports } = await escrow.cancelJob({ jobOfferPda: offer.pdaAddress });
      setLastTx({ feeLamports, note: "Vault closed — SOL returned to you (vault rent reclaimed)" });
      onTxDone?.();
      updateOfferStatus(offer.id, "cancelled");
      reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTxLoading(null);
    }
  }

  return (
    <div>
      {/* ── Last tx cost banner ── */}
      {lastTx && (
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#0f2318",
          border: "1px solid var(--success)",
          borderRadius: 8,
          padding: "10px 16px",
          marginBottom: 16,
          fontSize: 13,
        }}>
          <span style={{ color: "var(--success)" }}>
            <strong>Tx confirmed</strong> &nbsp;|&nbsp; Network fee:{" "}
            <strong>{(lastTx.feeLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL</strong>
            {" "}({lastTx.feeLamports.toLocaleString()} lamports)
            &nbsp;&mdash;&nbsp;{lastTx.note}
          </span>
          <button
            onClick={() => setLastTx(null)}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── Create offer form ── */}
      <div className="card">
        <p className="section-title">Post a Job</p>
        <form onSubmit={handleCreate}>
          <div className="form-group">
            <label>Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Build a Solana NFT mint page"
              maxLength={100}
              required
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the job, requirements, and deliverables…"
              maxLength={500}
              required
            />
          </div>
          <div className="form-group">
            <label>Budget (SOL)</label>
            <input
              type="number"
              value={amountSol}
              onChange={(e) => setAmountSol(e.target.value)}
              placeholder="0.5"
              step="0.01"
              min="0.001"
              required
            />
          </div>
          {error && (
            <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>
              {error}
            </p>
          )}
          <button className="btn btn-primary" type="submit" disabled={creating}>
            {creating ? "Posting…" : "Post Job"}
          </button>
        </form>
      </div>

      <div className="divider" />

      {/* ── My job offers ── */}
      <p className="section-title">My Job Offers</p>

      {offers.length === 0 && (
        <p className="empty">No job offers yet. Post your first job above.</p>
      )}

      {offers.map((offer) => {
        const proposals = proposalsMap[offer.id] ?? [];
        const pendingProposals = proposals.filter((p) => p.status === "pending");

        return (
          <div key={offer.id} className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div>
                <p className="card-title">{offer.title}</p>
                <p className="card-meta">
                  {new Date(offer.createdAt).toLocaleString()}
                </p>
              </div>
              <span className={`badge badge-${offer.status}`}>
                {offer.status}
              </span>
            </div>

            <p className="card-desc">{offer.description}</p>
            <p className="card-amount">
              {(offer.amount / LAMPORTS_PER_SOL).toFixed(3)} SOL
            </p>

            {/* Action buttons for accepted jobs */}
            {offer.status === "accepted" && offer.acceptedFreelancer && (
              <>
                <p className="card-meta">
                  Freelancer:{" "}
                  <code style={{ fontSize: 11 }}>
                    {offer.acceptedFreelancer.slice(0, 8)}…
                    {offer.acceptedFreelancer.slice(-6)}
                  </code>
                </p>
                <div className="btn-row">
                  <button
                    className="btn btn-success"
                    onClick={() => handlePay(offer)}
                    disabled={txLoading === `pay-${offer.id}`}
                  >
                    {txLoading === `pay-${offer.id}` ? "Sending…" : "Pay Freelancer"}
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => handleCancel(offer)}
                    disabled={txLoading === `cancel-${offer.id}`}
                  >
                    {txLoading === `cancel-${offer.id}` ? "Cancelling…" : "Cancel Job"}
                  </button>
                </div>
              </>
            )}

            {offer.status === "open" && (
              <div className="btn-row">
                <button
                  className="btn btn-outline"
                  onClick={() => handleCancel(offer)}
                  disabled={txLoading === `cancel-${offer.id}`}
                >
                  {txLoading === `cancel-${offer.id}` ? "Cancelling…" : "Cancel Job"}
                </button>
              </div>
            )}

            {/* Proposals */}
            {(offer.status === "open" || offer.status === "accepted") && (
              <div className="proposals-section">
                <h4>
                  Proposals ({proposals.length}){" "}
                  {pendingProposals.length > 0 && (
                    <span className="badge badge-pending">
                      {pendingProposals.length} pending
                    </span>
                  )}
                </h4>

                {proposals.length === 0 && (
                  <p className="empty" style={{ padding: "12px 0" }}>
                    No proposals yet.
                  </p>
                )}

                {proposals.map((p) => (
                  <div key={p.id} className="proposal-item">
                    <p className="proposal-freelancer">
                      Freelancer: {p.freelancer.slice(0, 8)}…{p.freelancer.slice(-6)}
                    </p>
                    <p className="proposal-message">{p.message}</p>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span className={`badge badge-${p.status}`}>
                        {p.status}
                      </span>
                      {p.status === "pending" && offer.status === "open" && (
                        <div className="btn-row" style={{ margin: 0 }}>
                          <button
                            className="btn btn-success"
                            style={{ padding: "6px 14px", fontSize: 12 }}
                            onClick={() => handleAccept(offer, p)}
                            disabled={!!txLoading}
                          >
                            {txLoading === `accept-${p.id}` ? "…" : "Accept"}
                          </button>
                          <button
                            className="btn btn-danger"
                            style={{ padding: "6px 14px", fontSize: 12 }}
                            onClick={() => handleDecline(offer, p)}
                            disabled={!!txLoading}
                          >
                            {txLoading === `decline-${p.id}` ? "…" : "Decline"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
