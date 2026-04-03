// ─── Domain types shared between mock DB and components ─────────────────────

export type JobStatus = "open" | "accepted" | "completed" | "cancelled";
export type ProposalStatus = "pending" | "accepted" | "declined";

export interface JobOffer {
  /** Local UUID — also used as job_id seed (stored as u64 timestamp) */
  id: string;
  /** job_id used as PDA seed (bigint timestamp) */
  jobId: bigint;
  /** On-chain PDA address of this offer */
  pdaAddress: string;
  client: string; // wallet pubkey
  title: string;
  description: string;
  /** Amount in lamports */
  amount: number;
  status: JobStatus;
  /** Set when client accepts a proposal */
  acceptedFreelancer?: string;
  createdAt: number; // Date.now()
}

export interface JobProposal {
  id: string;
  /** On-chain PDA address of this proposal */
  pdaAddress: string;
  jobOfferId: string; // references JobOffer.id
  jobOfferPda: string;
  freelancer: string; // wallet pubkey
  message: string;
  status: ProposalStatus;
  createdAt: number;
}
