/**
 * GovernanceProposer - Token-weighted voting with quorum enforcement
 *
 * Handles proposal creation, voting, and lifecycle management for DAO governance.
 */

export type ProposalStatus = 'pending' | 'active' | 'passed' | 'rejected' | 'executed';

export interface Proposal {
  proposalId: string;
  title: string;
  description: string;
  proposer: string;
  status: ProposalStatus;
  votesFor: bigint;
  votesAgainst: bigint;
  createdAt: number;
  expiresAt: number;
  executionPayload: string;
}

export interface Vote {
  voter: string;
  proposalId: string;
  support: boolean;
  weight: bigint;
  castAt: number;
}

export interface GovernanceProposerConfig {
  votingPeriodSec: number;
  quorumFraction: number;
  dryRun: boolean;
}

export class GovernanceProposer {
  private proposals: Map<string, Proposal>;
  private votes: Map<string, Vote[]>;
  private config: Required<GovernanceProposerConfig>;

  constructor(config?: Partial<GovernanceProposerConfig>) {
    this.proposals = new Map();
    this.votes = new Map();
    this.config = {
      votingPeriodSec: config?.votingPeriodSec ?? 604800,
      quorumFraction: config?.quorumFraction ?? 0.1,
      dryRun: config?.dryRun ?? true,
    };
  }

  createProposal(
    title: string,
    description: string,
    proposer: string,
    executionPayload: string
  ): string {
    if (!title || !description) {
      throw new Error('Title and description are required');
    }

    const proposalId = this.generateProposalId();
    const now = Date.now();

    const proposal: Proposal = {
      proposalId,
      title,
      description,
      proposer,
      status: 'active',
      votesFor: BigInt(0),
      votesAgainst: BigInt(0),
      createdAt: now,
      expiresAt: now + this.config.votingPeriodSec * 1000,
      executionPayload,
    };

    this.proposals.set(proposalId, proposal);
    this.votes.set(proposalId, []);

    return proposalId;
  }

  vote(proposalId: string, voter: string, support: boolean, weight: bigint): void {
    if (weight <= BigInt(0)) {
      throw new Error('Vote weight must be positive');
    }

    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error('Proposal not found');
    }

    if (proposal.status !== 'active') {
      throw new Error('Proposal is not active');
    }

    if (Date.now() > proposal.expiresAt) {
      throw new Error('Voting period has expired');
    }

    const proposalVotes = this.votes.get(proposalId) ?? [];
    const hasVoted = proposalVotes.some(v => v.voter === voter);
    if (hasVoted) {
      throw new Error('Voter has already voted');
    }

    const vote: Vote = {
      voter,
      proposalId,
      support,
      weight,
      castAt: Date.now(),
    };

    proposalVotes.push(vote);
    this.votes.set(proposalId, proposalVotes);

    if (support) {
      proposal.votesFor += weight;
    } else {
      proposal.votesAgainst += weight;
    }
  }

  getProposal(proposalId: string): Proposal | undefined {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return undefined;

    return { ...proposal };
  }

  listActiveProposals(): Proposal[] {
    const now = Date.now();
    return Array.from(this.proposals.values())
      .filter(p => p.status === 'active' && p.expiresAt > now)
      .map(p => ({ ...p }));
  }

  finalise(proposalId: string, totalSupply: bigint): ProposalStatus {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error('Proposal not found');
    }

    if (proposal.status !== 'active') {
      return proposal.status;
    }

    const totalVotes = proposal.votesFor + proposal.votesAgainst;
    const quorumRequired = (totalSupply * BigInt(Math.floor(this.config.quorumFraction * 100))) / BigInt(100);
    const quorumMet = totalVotes >= quorumRequired;

    if (!quorumMet) {
      proposal.status = 'rejected';
      return 'rejected';
    }

    if (proposal.votesFor > proposal.votesAgainst) {
      proposal.status = 'passed';
      return 'passed';
    } else {
      proposal.status = 'rejected';
      return 'rejected';
    }
  }

  getVotes(proposalId: string): Vote[] {
    const proposalVotes = this.votes.get(proposalId);
    if (!proposalVotes) return [];

    return proposalVotes.map(v => ({ ...v }));
  }

  private generateProposalId(): string {
    const timestamp = Date.now().toString(16);
    const random = Math.random().toString(16).slice(2);
    return `prop_${timestamp}_${random}`;
  }
}
