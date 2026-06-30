import type { LinkResult, OrganizeResult, QualityResult } from "../schema";
import type { Period, ThoughtCard } from "../types";

export interface OrganizeTranscriptInput {
  recordingId: string;
  rawText: string;
  createdAt: string;
  version: number;
  deepMode?: boolean;
}

export interface LinkCardsInput {
  newCards: ThoughtCard[];
  candidateCards: ThoughtCard[];
}

export interface SummaryInput {
  period: Period;
  periodKey: string;
  cards: ThoughtCard[];
  relations: Array<{
    fromTitle: string;
    toTitle: string;
    relationType: string;
    rationale: string;
  }>;
}

export interface LLMProvider {
  name: string;
  correctTranscript(input: { rawText: string }): Promise<string>;
  organizeTranscript(input: OrganizeTranscriptInput): Promise<OrganizeResult>;
  linkCards(input: LinkCardsInput): Promise<LinkResult>;
  checkQuality(input: { rawText: string; cards: ThoughtCard[] }): Promise<QualityResult>;
  writeSummary(input: SummaryInput): Promise<string>;
  writeListeningScript(input: SummaryInput & { summaryMarkdown: string }): Promise<string>;
}
