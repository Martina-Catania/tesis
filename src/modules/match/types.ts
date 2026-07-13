// ─── Matching Module Types ────────────────────────────────────────────────────

/**
 * A MeasurementData row joined with its total package count
 * (summed across all Package children).
 */
export interface MeasurementDataWithCount {
    id: number;
    date: Date;
    clientId: number;
    totalPackages: number;
    periodId?: number | null;
    volumeM3?: number;
}

/**
 * A MeasurementDataError row, shaped for matching.
 * `packages` is the raw JSON field parsed to Package[] or null.
 */
export interface MeasurementDataErrorRow {
    id: number;
    date: Date;
    clientId: number | null;
    clientName: string | null;
    packages: Array<{ quantity: number }> | null;
    errors: string[];
}

/**
 * A Remito row shaped for matching.
 */
export interface RemitoRow {
    id: number;
    date: Date;
    clientId: number | null;
    clientName: string | null;
    address?: string | null;
    zone?: string | null;
    packages: number | null;
}

/**
 * A RemitoError row shaped for matching.
 */
export interface RemitoErrorRow {
    id: number;
    date: Date;
    clientName: string | null;
    address?: string | null;
    packages: number | null;
    errors: string[];
}

// ─── Candidate groups ─────────────────────────────────────────────────────────

/**
 * All unmatched records for a single client on a single calendar day,
 * collected before deciding the outcome.
 */
export interface MatchCandidate {
    clientId: number;
    deliveryDate: Date; // midnight UTC of the calendar day

    tariff?: number | null;

    measurement: MeasurementDataWithCount | null;
    measurementError: MeasurementDataErrorRow | null;

    remito: RemitoRow | null;
    remitoError: RemitoErrorRow | null;
}

// ─── Match outcomes ───────────────────────────────────────────────────────────

export type MatchOutcome =
    | { kind: 'success'; candidate: MatchCandidate }
    | { kind: 'error';   candidate: MatchCandidate; errors: string[] };

// ─── Run result (returned to the controller for CSV + WhatsApp) ───────────────

export interface MatchRunResult {
    ranAt: Date;
    successCount: number;
    errorCount: number;
    skippedCount: number; // candidates where only one side exists (no pair yet)
    outcomes: MatchOutcome[];
}