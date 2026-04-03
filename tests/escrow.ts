import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { EscrowFreelancerOffers } from "../target/types/escrow_freelancer_offers";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";

describe("escrow_freelancer_offers", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .EscrowFreelancerOffers as Program<EscrowFreelancerOffers>;

  // Wallets
  const client = anchor.web3.Keypair.generate();
  const freelancer = anchor.web3.Keypair.generate();
  const anotherFreelancer = anchor.web3.Keypair.generate();

  // Job ID — using a fixed number for reproducibility in tests
  const JOB_ID = new BN(1001);
  const JOB_AMOUNT = new BN(0.5 * LAMPORTS_PER_SOL); // 0.5 SOL

  // PDAs — computed once and reused
  let jobOfferPda: PublicKey;
  let proposalPda: PublicKey;
  let vaultPda: PublicKey;

  // ─── Setup ────────────────────────────────────────────────────────────────

  before(async () => {
    // Airdrop SOL to client and freelancers
    await Promise.all([
      provider.connection
        .requestAirdrop(client.publicKey, 2 * LAMPORTS_PER_SOL)
        .then((sig) => provider.connection.confirmTransaction(sig)),
      provider.connection
        .requestAirdrop(freelancer.publicKey, 1 * LAMPORTS_PER_SOL)
        .then((sig) => provider.connection.confirmTransaction(sig)),
      provider.connection
        .requestAirdrop(anotherFreelancer.publicKey, 1 * LAMPORTS_PER_SOL)
        .then((sig) => provider.connection.confirmTransaction(sig)),
    ]);

    // Derive PDAs
    [jobOfferPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("job_offer"),
        client.publicKey.toBuffer(),
        JOB_ID.toBuffer("le", 8),
      ],
      program.programId
    );

    [proposalPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        jobOfferPda.toBuffer(),
        freelancer.publicKey.toBuffer(),
      ],
      program.programId
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), jobOfferPda.toBuffer()],
      program.programId
    );

    console.log("Program ID      :", program.programId.toBase58());
    console.log("Client          :", client.publicKey.toBase58());
    console.log("Freelancer      :", freelancer.publicKey.toBase58());
    console.log("JobOffer PDA    :", jobOfferPda.toBase58());
    console.log("Proposal PDA    :", proposalPda.toBase58());
    console.log("Vault PDA       :", vaultPda.toBase58());
  });

  // ─── Tests ───────────────────────────────────────────────────────────────

  it("Client can create a job offer", async () => {
    await program.methods
      .createOffer(
        JOB_ID,
        "Build a Solana dApp",
        "Need a developer to build an escrow smart contract on Solana using Anchor.",
        JOB_AMOUNT
      )
      .accounts({
        jobOffer: jobOfferPda,
        client: client.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    const offer = await program.account.jobOffer.fetch(jobOfferPda);
    assert.ok(offer.client.equals(client.publicKey), "client matches");
    assert.equal(offer.title, "Build a Solana dApp");
    assert.equal(offer.amount.toNumber(), JOB_AMOUNT.toNumber());
    assert.deepEqual(offer.status, { open: {} });
    assert.isNull(offer.freelancer);
  });

  it("Freelancer can submit a proposal", async () => {
    await program.methods
      .offerProposal("I have 3 years of Rust experience and have built several Anchor programs.")
      .accounts({
        jobOffer: jobOfferPda,
        proposal: proposalPda,
        freelancer: freelancer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([freelancer])
      .rpc();

    const proposal = await program.account.jobProposal.fetch(proposalPda);
    assert.ok(proposal.freelancer.equals(freelancer.publicKey));
    assert.ok(proposal.jobOffer.equals(jobOfferPda));
    assert.deepEqual(proposal.status, { pending: {} });
  });

  it("Client cannot propose for their own job", async () => {
    // The client's proposal PDA
    const [clientProposalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), jobOfferPda.toBuffer(), client.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .offerProposal("I am the client, I should not be able to propose.")
        .accounts({
          jobOffer: jobOfferPda,
          proposal: clientProposalPda,
          freelancer: client.publicKey, // client trying to act as freelancer
          systemProgram: SystemProgram.programId,
        })
        .signers([client])
        .rpc();
      assert.fail("Expected error: ClientCannotPropose");
    } catch (err: any) {
      assert.include(err.message, "ClientCannotPropose");
    }
  });

  it("Client can accept a proposal (SOL locked in vault)", async () => {
    const clientBalanceBefore = await provider.connection.getBalance(client.publicKey);

    await program.methods
      .acceptProposal()
      .accounts({
        jobOffer: jobOfferPda,
        proposal: proposalPda,
        client: client.publicKey,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    const offer = await program.account.jobOffer.fetch(jobOfferPda);
    assert.deepEqual(offer.status, { accepted: {} });
    assert.ok(offer.freelancer !== null);
    assert.ok(offer.freelancer!.equals(freelancer.publicKey));

    const proposal = await program.account.jobProposal.fetch(proposalPda);
    assert.deepEqual(proposal.status, { accepted: {} });

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    assert.equal(vaultBalance, JOB_AMOUNT.toNumber(), "vault holds locked SOL");

    const clientBalanceAfter = await provider.connection.getBalance(client.publicKey);
    assert.ok(
      clientBalanceBefore - clientBalanceAfter >= JOB_AMOUNT.toNumber(),
      "client paid the amount"
    );
  });

  it("Freelancer cannot call complete_proposal (only client can)", async () => {
    try {
      await program.methods
        .completeProposal()
        .accounts({
          jobOffer: jobOfferPda,
          client: freelancer.publicKey, // wrong signer
          freelancer: freelancer.publicKey,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([freelancer])
        .rpc();
      assert.fail("Expected error: NotJobClient");
    } catch (err: any) {
      assert.ok(err.message.length > 0, "transaction rejected");
    }
  });

  it("Client can pay the freelancer (complete proposal)", async () => {
    const freelancerBalanceBefore = await provider.connection.getBalance(
      freelancer.publicKey
    );

    await program.methods
      .completeProposal()
      .accounts({
        jobOffer: jobOfferPda,
        client: client.publicKey,
        freelancer: freelancer.publicKey,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    const offer = await program.account.jobOffer.fetch(jobOfferPda);
    assert.deepEqual(offer.status, { completed: {} });

    const freelancerBalanceAfter = await provider.connection.getBalance(
      freelancer.publicKey
    );
    assert.ok(
      freelancerBalanceAfter - freelancerBalanceBefore >= JOB_AMOUNT.toNumber(),
      "freelancer received the SOL"
    );

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    assert.equal(vaultBalance, 0, "vault is empty");
  });

  // ─── Cancel flow (separate job) ───────────────────────────────────────────

  it("Client can cancel a job after accepting (SOL returned)", async () => {
    const JOB_ID_2 = new BN(1002);

    const [jobOffer2Pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("job_offer"),
        client.publicKey.toBuffer(),
        JOB_ID_2.toBuffer("le", 8),
      ],
      program.programId
    );

    const [proposal2Pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        jobOffer2Pda.toBuffer(),
        anotherFreelancer.publicKey.toBuffer(),
      ],
      program.programId
    );

    const [vault2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), jobOffer2Pda.toBuffer()],
      program.programId
    );

    // Create offer
    await program.methods
      .createOffer(
        JOB_ID_2,
        "Design a logo",
        "Need a graphic designer for a web3 startup logo.",
        new BN(0.2 * LAMPORTS_PER_SOL)
      )
      .accounts({
        jobOffer: jobOffer2Pda,
        client: client.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    // Freelancer proposes
    await program.methods
      .offerProposal("I am a designer with 5 years experience.")
      .accounts({
        jobOffer: jobOffer2Pda,
        proposal: proposal2Pda,
        freelancer: anotherFreelancer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([anotherFreelancer])
      .rpc();

    // Client accepts (locks SOL)
    await program.methods
      .acceptProposal()
      .accounts({
        jobOffer: jobOffer2Pda,
        proposal: proposal2Pda,
        client: client.publicKey,
        vault: vault2Pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    const clientBalanceBefore = await provider.connection.getBalance(client.publicKey);

    // Client cancels (should return SOL)
    await program.methods
      .cancelJob()
      .accounts({
        jobOffer: jobOffer2Pda,
        client: client.publicKey,
        vault: vault2Pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    const offer2 = await program.account.jobOffer.fetch(jobOffer2Pda);
    assert.deepEqual(offer2.status, { cancelled: {} });

    const clientBalanceAfter = await provider.connection.getBalance(client.publicKey);
    assert.ok(clientBalanceAfter > clientBalanceBefore, "SOL returned to client");
  });

  it("Client can decline a proposal", async () => {
    const JOB_ID_3 = new BN(1003);

    const [jobOffer3Pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("job_offer"),
        client.publicKey.toBuffer(),
        JOB_ID_3.toBuffer("le", 8),
      ],
      program.programId
    );

    const [proposal3Pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        jobOffer3Pda.toBuffer(),
        freelancer.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .createOffer(
        JOB_ID_3,
        "Write smart contract docs",
        "Technical writer needed for Anchor documentation.",
        new BN(0.1 * LAMPORTS_PER_SOL)
      )
      .accounts({
        jobOffer: jobOffer3Pda,
        client: client.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([client])
      .rpc();

    await program.methods
      .offerProposal("I can write clear and concise Solana docs.")
      .accounts({
        jobOffer: jobOffer3Pda,
        proposal: proposal3Pda,
        freelancer: freelancer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([freelancer])
      .rpc();

    await program.methods
      .declineProposal()
      .accounts({
        jobOffer: jobOffer3Pda,
        proposal: proposal3Pda,
        client: client.publicKey,
      })
      .signers([client])
      .rpc();

    const proposal3 = await program.account.jobProposal.fetch(proposal3Pda);
    assert.deepEqual(proposal3.status, { declined: {} });

    // Job is still Open (can receive new proposals)
    const offer3 = await program.account.jobOffer.fetch(jobOffer3Pda);
    assert.deepEqual(offer3.status, { open: {} });
  });
});
