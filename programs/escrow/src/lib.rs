use anchor_lang::prelude::*;

// After first `anchor build`, run `anchor keys sync` to update this ID.
declare_id!("2v5LKTZViJQ7hQNz7YoARjyaDQoRZKDzX1VtX8Evdfxx");

#[program]
pub mod escrow_freelancer_offers {
    use super::*;

    /// Client creates a job offer on-chain.
    /// `job_id` is a client-generated u64 (e.g. timestamp) used as a PDA seed
    /// so the same client can create multiple offers.
    pub fn create_offer(
        ctx: Context<CreateOffer>,
        job_id: u64,
        title: String,
        description: String,
        amount: u64, // in lamports
    ) -> Result<()> {
        require!(title.len() <= JobOffer::MAX_TITLE_LEN, EscrowError::TitleTooLong);
        require!(description.len() <= JobOffer::MAX_DESC_LEN, EscrowError::DescriptionTooLong);
        require!(amount > 0, EscrowError::InvalidAmount);

        let offer = &mut ctx.accounts.job_offer;
        offer.client = ctx.accounts.client.key();
        offer.job_id = job_id;
        offer.title = title;
        offer.description = description;
        offer.amount = amount;
        offer.status = JobStatus::Open;
        offer.freelancer = None;
        offer.bump = ctx.bumps.job_offer;

        msg!("Job offer created: job_id={}", job_id);
        Ok(())
    }

    /// Freelancer submits a proposal for an open job.
    /// Only one proposal per (freelancer, job) pair allowed (enforced by PDA).
    pub fn offer_proposal(
        ctx: Context<OfferProposal>,
        message: String,
    ) -> Result<()> {
        require!(message.len() <= JobProposal::MAX_MSG_LEN, EscrowError::MessageTooLong);

        let offer = &ctx.accounts.job_offer;
        require!(offer.status == JobStatus::Open, EscrowError::JobNotOpen);
        require!(
            offer.client != ctx.accounts.freelancer.key(),
            EscrowError::ClientCannotPropose
        );

        let proposal = &mut ctx.accounts.proposal;
        proposal.job_offer = ctx.accounts.job_offer.key();
        proposal.freelancer = ctx.accounts.freelancer.key();
        proposal.message = message;
        proposal.status = ProposalStatus::Pending;
        proposal.bump = ctx.bumps.proposal;

        msg!("Proposal submitted by freelancer: {}", ctx.accounts.freelancer.key());
        Ok(())
    }

    /// Client accepts a freelancer's proposal.
    /// Transfers `amount` lamports from client wallet to the vault PDA, locking them.
    pub fn accept_proposal(ctx: Context<AcceptProposal>) -> Result<()> {
        let offer = &ctx.accounts.job_offer;
        require!(offer.status == JobStatus::Open, EscrowError::JobNotOpen);

        let proposal = &ctx.accounts.proposal;
        require!(proposal.status == ProposalStatus::Pending, EscrowError::ProposalNotPending);

        // Lock SOL: client → vault PDA
        let amount = offer.amount;
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.client.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;

        // Update state
        let offer = &mut ctx.accounts.job_offer;
        offer.status = JobStatus::Accepted;
        offer.freelancer = Some(ctx.accounts.proposal.freelancer);

        let proposal = &mut ctx.accounts.proposal;
        proposal.status = ProposalStatus::Accepted;

        msg!("Proposal accepted. {} lamports locked in vault.", amount);
        Ok(())
    }

    /// Client pays the freelancer — releases locked SOL from vault to freelancer wallet.
    pub fn complete_proposal(ctx: Context<CompleteProposal>) -> Result<()> {
        require!(
            ctx.accounts.job_offer.status == JobStatus::Accepted,
            EscrowError::JobNotAccepted
        );

        let amount = ctx.accounts.job_offer.amount;
        let job_offer_key = ctx.accounts.job_offer.key();
        let vault_bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[b"vault", job_offer_key.as_ref(), &[vault_bump]];

        // Release SOL: vault → freelancer
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.freelancer.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        ctx.accounts.job_offer.status = JobStatus::Completed;

        msg!("Job completed. {} lamports paid to freelancer.", amount);
        Ok(())
    }

    /// Client cancels the job.
    /// If the job was accepted (SOL locked), returns the SOL to the client.
    /// If it was still Open (no SOL locked), just marks it as cancelled.
    pub fn cancel_job(ctx: Context<CancelJob>) -> Result<()> {
        let status = ctx.accounts.job_offer.status.clone();
        require!(
            status == JobStatus::Open || status == JobStatus::Accepted,
            EscrowError::CannotCancel
        );

        if status == JobStatus::Accepted {
            let amount = ctx.accounts.job_offer.amount;
            let job_offer_key = ctx.accounts.job_offer.key();
            let vault_bump = ctx.bumps.vault;
            let seeds: &[&[u8]] = &[b"vault", job_offer_key.as_ref(), &[vault_bump]];

            // Return SOL: vault → client
            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.client.to_account_info(),
                    },
                    &[seeds],
                ),
                amount,
            )?;

            msg!("Job cancelled. {} lamports returned to client.", amount);
        } else {
            msg!("Open job cancelled — no SOL to return.");
        }

        ctx.accounts.job_offer.status = JobStatus::Cancelled;
        Ok(())
    }

    /// Client declines a freelancer's proposal (job stays Open for other proposals).
    pub fn decline_proposal(ctx: Context<DeclineProposal>) -> Result<()> {
        require!(
            ctx.accounts.job_offer.status == JobStatus::Open,
            EscrowError::JobNotOpen
        );
        require!(
            ctx.accounts.proposal.status == ProposalStatus::Pending,
            EscrowError::ProposalNotPending
        );

        ctx.accounts.proposal.status = ProposalStatus::Declined;

        msg!("Proposal declined.");
        Ok(())
    }
}

// ─── Account data structs ────────────────────────────────────────────────────

#[account]
pub struct JobOffer {
    pub client: Pubkey,             // 32 — who created the offer
    pub job_id: u64,                //  8 — unique ID chosen by client
    pub title: String,              //  4 + MAX_TITLE_LEN
    pub description: String,        //  4 + MAX_DESC_LEN
    pub amount: u64,                //  8 — SOL amount in lamports
    pub status: JobStatus,          //  1
    pub freelancer: Option<Pubkey>, //  1 + 32 — set when proposal accepted
    pub bump: u8,                   //  1
}

impl JobOffer {
    pub const MAX_TITLE_LEN: usize = 100;
    pub const MAX_DESC_LEN: usize = 500;
    pub const SPACE: usize = 8      // discriminator
        + 32 + 8                    // client, job_id
        + 4 + Self::MAX_TITLE_LEN   // title
        + 4 + Self::MAX_DESC_LEN    // description
        + 8                         // amount
        + 1                         // status
        + 1 + 32                    // freelancer (Option<Pubkey>)
        + 1;                        // bump
}

#[account]
pub struct JobProposal {
    pub job_offer: Pubkey,   // 32
    pub freelancer: Pubkey,  // 32
    pub message: String,     //  4 + MAX_MSG_LEN
    pub status: ProposalStatus, // 1
    pub bump: u8,            //  1
}

impl JobProposal {
    pub const MAX_MSG_LEN: usize = 300;
    pub const SPACE: usize = 8      // discriminator
        + 32 + 32                   // job_offer, freelancer
        + 4 + Self::MAX_MSG_LEN     // message
        + 1                         // status
        + 1;                        // bump
}

// ─── Enums ───────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum JobStatus {
    Open,      // freelancers can apply
    Accepted,  // client accepted a proposal + SOL locked in vault
    Completed, // client paid the freelancer
    Cancelled, // client cancelled (SOL returned if it was locked)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ProposalStatus {
    Pending,  // waiting for client decision
    Accepted, // client accepted this proposal
    Declined, // client declined this proposal
}

// ─── Instruction contexts ────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct CreateOffer<'info> {
    #[account(
        init,
        payer = client,
        space = JobOffer::SPACE,
        seeds = [b"job_offer", client.key().as_ref(), &job_id.to_le_bytes()],
        bump,
    )]
    pub job_offer: Account<'info, JobOffer>,

    #[account(mut)]
    pub client: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OfferProposal<'info> {
    pub job_offer: Account<'info, JobOffer>,

    #[account(
        init,
        payer = freelancer,
        space = JobProposal::SPACE,
        // One proposal per (freelancer, job) pair
        seeds = [b"proposal", job_offer.key().as_ref(), freelancer.key().as_ref()],
        bump,
    )]
    pub proposal: Account<'info, JobProposal>,

    #[account(mut)]
    pub freelancer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptProposal<'info> {
    #[account(
        mut,
        seeds = [b"job_offer", job_offer.client.as_ref(), &job_offer.job_id.to_le_bytes()],
        bump = job_offer.bump,
        has_one = client @ EscrowError::NotJobClient,
    )]
    pub job_offer: Account<'info, JobOffer>,

    #[account(
        mut,
        seeds = [
            b"proposal",
            job_offer.key().as_ref(),
            proposal.freelancer.as_ref(),
        ],
        bump = proposal.bump,
        constraint = proposal.job_offer == job_offer.key() @ EscrowError::ProposalMismatch,
    )]
    pub proposal: Account<'info, JobProposal>,

    #[account(mut)]
    pub client: Signer<'info>,

    /// CHECK: Vault PDA that holds the locked SOL. Created on first transfer.
    #[account(
        mut,
        seeds = [b"vault", job_offer.key().as_ref()],
        bump,
    )]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CompleteProposal<'info> {
    #[account(
        mut,
        seeds = [b"job_offer", job_offer.client.as_ref(), &job_offer.job_id.to_le_bytes()],
        bump = job_offer.bump,
        has_one = client @ EscrowError::NotJobClient,
    )]
    pub job_offer: Account<'info, JobOffer>,

    #[account(mut)]
    pub client: Signer<'info>,

    /// CHECK: Freelancer's wallet — validated against job_offer.freelancer field.
    #[account(
        mut,
        constraint = Some(freelancer.key()) == job_offer.freelancer @ EscrowError::WrongFreelancer,
    )]
    pub freelancer: UncheckedAccount<'info>,

    /// CHECK: Vault PDA holding the locked SOL.
    #[account(
        mut,
        seeds = [b"vault", job_offer.key().as_ref()],
        bump,
    )]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelJob<'info> {
    #[account(
        mut,
        seeds = [b"job_offer", job_offer.client.as_ref(), &job_offer.job_id.to_le_bytes()],
        bump = job_offer.bump,
        has_one = client @ EscrowError::NotJobClient,
    )]
    pub job_offer: Account<'info, JobOffer>,

    #[account(mut)]
    pub client: Signer<'info>,

    /// CHECK: Vault PDA — only needed if status is Accepted.
    #[account(
        mut,
        seeds = [b"vault", job_offer.key().as_ref()],
        bump,
    )]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DeclineProposal<'info> {
    #[account(
        seeds = [b"job_offer", job_offer.client.as_ref(), &job_offer.job_id.to_le_bytes()],
        bump = job_offer.bump,
        has_one = client @ EscrowError::NotJobClient,
    )]
    pub job_offer: Account<'info, JobOffer>,

    #[account(
        mut,
        seeds = [
            b"proposal",
            job_offer.key().as_ref(),
            proposal.freelancer.as_ref(),
        ],
        bump = proposal.bump,
        constraint = proposal.job_offer == job_offer.key() @ EscrowError::ProposalMismatch,
    )]
    pub proposal: Account<'info, JobProposal>,

    pub client: Signer<'info>,
}

// ─── Custom errors ────────────────────────────────────────────────────────────

#[error_code]
pub enum EscrowError {
    #[msg("Job title must be 100 characters or less")]
    TitleTooLong,
    #[msg("Job description must be 500 characters or less")]
    DescriptionTooLong,
    #[msg("Proposal message must be 300 characters or less")]
    MessageTooLong,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Job is not open for proposals")]
    JobNotOpen,
    #[msg("Job has not been accepted yet")]
    JobNotAccepted,
    #[msg("Only the job client can perform this action")]
    NotJobClient,
    #[msg("Client cannot submit a proposal for their own job")]
    ClientCannotPropose,
    #[msg("Proposal is not in pending status")]
    ProposalNotPending,
    #[msg("Proposal does not belong to this job")]
    ProposalMismatch,
    #[msg("Freelancer does not match the accepted proposal")]
    WrongFreelancer,
    #[msg("Job cannot be cancelled in its current status")]
    CannotCancel,
}
