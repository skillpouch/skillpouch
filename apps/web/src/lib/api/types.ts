// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wire types the web app reads, inferred from the shared Zod contracts so the
 * client and the API can never drift apart silently.
 */
import type {
	Artifact,
	BrowserMember,
	CliAuthRequestView,
	ConnectTokenCreated,
	ConnectTokenStatus,
	Device,
	FreeSpaceResponse,
	KeyEnvelope,
	MeResponse,
	Member,
	OperationResult,
	Plan,
	Pouch,
	PouchEvent,
	PublicShare,
	Revision,
	RosterResponse,
	SecurityEvent,
	SecuritySettings,
	Share,
	StorageUsage,
	UnlockParams,
	UnlockPrepared,
} from '@skillpouch/contracts';
import type { z } from 'zod';

export type Me = z.infer<typeof MeResponse>;
export type PouchRecord = z.infer<typeof Pouch>;
export type ArtifactRecord = z.infer<typeof Artifact>;
export type RevisionRecord = z.infer<typeof Revision>;
export type MemberRecord = z.infer<typeof Member>;
export type RosterPage = z.infer<typeof RosterResponse>;
export type KeyEnvelopeRecord = z.infer<typeof KeyEnvelope>;
export type DeviceRecord = z.infer<typeof Device>;
export type BrowserRecord = z.infer<typeof BrowserMember>;
export type UnlockParamsRecord = z.infer<typeof UnlockParams>;
export type UnlockPreparedRecord = z.infer<typeof UnlockPrepared>;
export type ConnectToken = z.infer<typeof ConnectTokenCreated>;
export type ConnectTokenState = z.infer<typeof ConnectTokenStatus>;
export type CliAuthRequest = z.infer<typeof CliAuthRequestView>;
export type StorageUsageRecord = z.infer<typeof StorageUsage>;
export type FreeSpaceResult = z.infer<typeof FreeSpaceResponse>;
export type ShareRecord = z.infer<typeof Share>;
export type PublicShareRecord = z.infer<typeof PublicShare>;
export type PlanRecord = z.infer<typeof Plan>;
export type SecurityEventRecord = z.infer<typeof SecurityEvent>;
export type SecuritySettingsRecord = z.infer<typeof SecuritySettings>;
export type PouchEventRecord = z.infer<typeof PouchEvent>;
export type OperationResultRecord = z.infer<typeof OperationResult>;

export interface Invoice {
	id: string;
	created_at: string;
	description: string;
	amount_cents: number;
	currency: string;
	status: 'paid' | 'refunded' | 'partially_refunded' | 'pending' | 'failed';
	invoice_available: boolean;
	receipt_available: boolean;
}

export interface Subscription {
	status: string;
	plan_slug: string | null;
	interval: string | null;
	amount_cents: number;
	current_period_end: string | null;
	cancel_at_period_end: boolean;
}

export interface BillingOverview {
	available: boolean;
	subscriptions: Subscription[];
}
