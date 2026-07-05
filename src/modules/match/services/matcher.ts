import { MatchCandidate, MatchOutcome } from '../types';

// ─── Decision logic ───────────────────────────────────────────────────────────

/**
 * Evaluates a single MatchCandidate and returns the outcome.
 *
 * Rules (in priority order):
 *
 * 1. If either side is an error record → DeliveryError, carry all errors from
 *    both sides.
 * 2. If both sides are clean records but package counts differ → DeliveryError
 *    with a mismatch message.
 * 3. Both clean + counts match → DeliveryMatch (success).
 *
 * The function is pure (no DB calls) so it is easy to unit-test.
 */
export function evaluateCandidate(candidate: MatchCandidate): MatchOutcome {
    const { measurement, measurementError, remito, remitoError } = candidate;

    const errors: string[] = [];

    // ── Collect errors from both sides ────────────────────────────────────────

    const hasErrorSide = measurementError !== null || remitoError !== null;

    if (measurementError) {
        errors.push(...measurementError.errors);
    }
    if (remitoError) {
        errors.push(...remitoError.errors);
    }

    // ── If either side is an error record, the whole delivery is an error ─────

    if (hasErrorSide) {
        console.log(
            `[Matching] Candidate clientId=${candidate.clientId} ` +
            `date=${fmtDate(candidate.deliveryDate)}: error side present — saving as DeliveryError`,
        );
        return { kind: 'error', candidate, errors };
    }

    // ── Both sides are clean records — validate package counts ────────────────

    // At this point measurement and remito are guaranteed non-null
    const measured = measurement!.totalPackages;
    const declared = remito!.packages;

    if (declared === null || declared === undefined) {
        // Remito has no package count — treat as a warning error
        errors.push(
            'El remito no tiene cantidad de bultos registrada; no se pudo validar contra los bultos medidos.',
        );
        console.log(
            `[Matching] Candidate clientId=${candidate.clientId} ` +
            `date=${fmtDate(candidate.deliveryDate)}: remito missing package count — saving as DeliveryError`,
        );
        return { kind: 'error', candidate, errors };
    }

    if (measured !== declared) {
        errors.push(
            `Discrepancia en cantidad de bultos: se midieron ${measured} pero el remito declara ${declared}.`,
        );
        console.log(
            `[Matching] Candidate clientId=${candidate.clientId} ` +
            `date=${fmtDate(candidate.deliveryDate)}: package mismatch (${measured} vs ${declared}) — saving as DeliveryError`,
        );
        return { kind: 'error', candidate, errors };
    }

    // ── Happy path ────────────────────────────────────────────────────────────

    console.log(
        `[Matching] Candidate clientId=${candidate.clientId} ` +
        `date=${fmtDate(candidate.deliveryDate)}: matched successfully (${measured} packages)`,
    );
    return { kind: 'success', candidate };
}

// ─── Batch evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluates an array of candidates and returns all outcomes.
 * Each candidate is evaluated independently.
 */
export function evaluateCandidates(candidates: MatchCandidate[]): MatchOutcome[] {
    return candidates.map(evaluateCandidate);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}