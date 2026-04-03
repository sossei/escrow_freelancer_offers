/**
 * Mock local "database" stored in localStorage.
 * This simulates a backend database for the prototype.
 * On-chain data is the source of truth for SOL transfers;
 * this local DB is the source of truth for job/proposal metadata.
 */

import { JobOffer, JobProposal } from "./types";

const OFFERS_KEY = "escrow:job_offers";
const PROPOSALS_KEY = "escrow:proposals";

// ─── Job Offers ──────────────────────────────────────────────────────────────

export function getOffers(): JobOffer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(OFFERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as JobOffer[];
    // Revive bigint from string
    return parsed.map((o) => ({ ...o, jobId: BigInt(o.jobId as unknown as string) }));
  } catch {
    return [];
  }
}

export function saveOffer(offer: JobOffer): void {
  const offers = getOffers();
  const idx = offers.findIndex((o) => o.id === offer.id);
  if (idx >= 0) {
    offers[idx] = offer;
  } else {
    offers.push(offer);
  }
  // Store bigint as string (JSON.stringify can't handle bigint natively)
  const serializable = offers.map((o) => ({ ...o, jobId: o.jobId.toString() }));
  localStorage.setItem(OFFERS_KEY, JSON.stringify(serializable));
}

export function updateOfferStatus(
  offerId: string,
  status: JobOffer["status"],
  acceptedFreelancer?: string
): void {
  const offers = getOffers();
  const offer = offers.find((o) => o.id === offerId);
  if (!offer) return;
  offer.status = status;
  if (acceptedFreelancer) offer.acceptedFreelancer = acceptedFreelancer;
  saveOffer(offer);
}

// ─── Proposals ───────────────────────────────────────────────────────────────

export function getProposals(): JobProposal[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PROPOSALS_KEY);
    return raw ? (JSON.parse(raw) as JobProposal[]) : [];
  } catch {
    return [];
  }
}

export function saveProposal(proposal: JobProposal): void {
  const proposals = getProposals();
  const idx = proposals.findIndex((p) => p.id === proposal.id);
  if (idx >= 0) {
    proposals[idx] = proposal;
  } else {
    proposals.push(proposal);
  }
  localStorage.setItem(PROPOSALS_KEY, JSON.stringify(proposals));
}

export function updateProposalStatus(
  proposalId: string,
  status: JobProposal["status"]
): void {
  const proposals = getProposals();
  const p = proposals.find((x) => x.id === proposalId);
  if (!p) return;
  p.status = status;
  saveProposal(p);
}

/** Proposals for a specific job offer */
export function getProposalsForJob(jobOfferId: string): JobProposal[] {
  return getProposals().filter((p) => p.jobOfferId === jobOfferId);
}

/** Proposals submitted by a specific freelancer */
export function getProposalsByFreelancer(freelancerPubkey: string): JobProposal[] {
  return getProposals().filter((p) => p.freelancer === freelancerPubkey);
}
