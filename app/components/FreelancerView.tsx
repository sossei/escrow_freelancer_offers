"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useEscrowProgram, deriveProposalPda } from "../lib/useEscrowProgram";
import {
  getOffers,
  saveProposal,
  getProposalsByFreelancer,
} from "../lib/mockDb";
import type { JobOffer, JobProposal } from "../lib/types";
import { PublicKey } from "@solana/web3.js";

export function FreelancerView() {
  const { publicKey } = useWallet();
  const escrow = useEscrowProgram();

  const [openOffers, setOpenOffers] = useState<JobOffer[]>([]);
  const [myProposals, setMyProposals] = useState<JobProposal[]>([]);
  const [proposalMessages, setProposalMessages] = useState<
    Record<string, string>
  >({});
  const [submitting, setSubmitting] = useState<string | null>(null); // offer id
  const [error, setError] = useState("");

  const walletKey = publicKey?.toBase58() ?? "";

  function reload() {
    const allOffers = getOffers();
    // Open offers that are NOT from this wallet
    setOpenOffers(
      allOffers
        .filter((o) => o.status === "open" && o.client !== walletKey)
        .sort((a, b) => b.createdAt - a.createdAt)
    );
    setMyProposals(
      getProposalsByFreelancer(walletKey).sort(
        (a, b) => b.createdAt - a.createdAt
      )
    );
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletKey]);

  // Check if this freelancer already proposed for a given offer
  function alreadyProposed(offerId: string): boolean {
    return myProposals.some((p) => p.jobOfferId === offerId);
  }

  // ── Submit proposal ───────────────────────────────────────────────────────
  async function handlePropose(offer: JobOffer) {
    if (!publicKey) return;
    const message = (proposalMessages[offer.id] ?? "").trim();
    if (!message) {
      setError("Please write a proposal message.");
      return;
    }
    setError("");
    setSubmitting(offer.id);

    try {
      await escrow.offerProposal({
        jobOfferPda: offer.pdaAddress,
        message,
      });

      const jobOfferKey = new PublicKey(offer.pdaAddress);
      const proposalPda = deriveProposalPda(jobOfferKey, publicKey);

      const newProposal: JobProposal = {
        id: proposalPda.toBase58(),
        pdaAddress: proposalPda.toBase58(),
        jobOfferId: offer.id,
        jobOfferPda: offer.pdaAddress,
        freelancer: walletKey,
        message,
        status: "pending",
        createdAt: Date.now(),
      };
      saveProposal(newProposal);

      // Clear the message input for this offer
      setProposalMessages((prev) => ({ ...prev, [offer.id]: "" }));
      reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  }

  // Get the related offer for a proposal (for displaying job info)
  function getOfferForProposal(proposal: JobProposal): JobOffer | undefined {
    return getOffers().find((o) => o.id === proposal.jobOfferId);
  }

  return (
    <div>
      {/* ── Open jobs ── */}
      <p className="section-title">Available Jobs</p>

      {openOffers.length === 0 && (
        <p className="empty">No open jobs at the moment. Check back later.</p>
      )}

      {openOffers.map((offer) => {
        const proposed = alreadyProposed(offer.id);
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
                  Client: {offer.client.slice(0, 8)}…{offer.client.slice(-6)} ·{" "}
                  {new Date(offer.createdAt).toLocaleString()}
                </p>
              </div>
              <span className="badge badge-open">open</span>
            </div>

            <p className="card-desc">{offer.description}</p>
            <p className="card-amount">
              {(offer.amount / LAMPORTS_PER_SOL).toFixed(3)} SOL
            </p>

            {proposed ? (
              <p
                style={{
                  fontSize: 13,
                  color: "var(--success)",
                  marginTop: 8,
                }}
              >
                Proposal submitted — waiting for client decision.
              </p>
            ) : (
              <>
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <label>Your Proposal</label>
                  <textarea
                    value={proposalMessages[offer.id] ?? ""}
                    onChange={(e) =>
                      setProposalMessages((prev) => ({
                        ...prev,
                        [offer.id]: e.target.value,
                      }))
                    }
                    placeholder="Describe your experience and why you're the best fit…"
                    maxLength={300}
                    style={{ minHeight: 70 }}
                  />
                </div>
                {error && submitting === offer.id && (
                  <p
                    style={{
                      color: "var(--danger)",
                      fontSize: 13,
                      marginBottom: 8,
                    }}
                  >
                    {error}
                  </p>
                )}
                <button
                  className="btn btn-primary"
                  onClick={() => handlePropose(offer)}
                  disabled={submitting === offer.id}
                >
                  {submitting === offer.id ? "Submitting…" : "Submit Proposal"}
                </button>
              </>
            )}
          </div>
        );
      })}

      <div className="divider" />

      {/* ── My proposals ── */}
      <p className="section-title">My Proposals</p>

      {myProposals.length === 0 && (
        <p className="empty">
          You haven&apos;t submitted any proposals yet.
        </p>
      )}

      {myProposals.map((proposal) => {
        const offer = getOfferForProposal(proposal);
        return (
          <div key={proposal.id} className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div>
                <p className="card-title">
                  {offer?.title ?? "Job (not found locally)"}
                </p>
                <p className="card-meta">
                  {new Date(proposal.createdAt).toLocaleString()}
                </p>
              </div>
              <span className={`badge badge-${proposal.status}`}>
                {proposal.status}
              </span>
            </div>

            {offer && (
              <p className="card-amount" style={{ marginBottom: 4 }}>
                {(offer.amount / LAMPORTS_PER_SOL).toFixed(3)} SOL
              </p>
            )}

            <p className="card-desc">&ldquo;{proposal.message}&rdquo;</p>

            {/* Status context for freelancer */}
            {proposal.status === "accepted" && (
              <div
                style={{
                  marginTop: 10,
                  padding: "10px 14px",
                  background: "#1a2e1f",
                  borderRadius: 8,
                  fontSize: 13,
                  color: "var(--success)",
                }}
              >
                The client accepted your proposal and locked the SOL. Do the
                job — the client will release payment when complete.
              </div>
            )}

            {proposal.status === "declined" && (
              <div
                style={{
                  marginTop: 10,
                  padding: "10px 14px",
                  background: "#2e1a1a",
                  borderRadius: 8,
                  fontSize: 13,
                  color: "var(--danger)",
                }}
              >
                The client declined your proposal.
              </div>
            )}

            {/* Show overall job status if proposal was accepted */}
            {proposal.status === "accepted" && offer && (
              <div style={{ marginTop: 8 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Job status:{" "}
                </span>
                <span className={`badge badge-${offer.status}`}>
                  {offer.status}
                </span>
                {offer.status === "completed" && (
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--success)",
                      marginLeft: 8,
                    }}
                  >
                    Payment received!
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
