import { evaluateCandidate, evaluateCandidates } from './matcher';
import { MatchCandidate, MeasurementDataWithCount, MeasurementDataErrorRow, RemitoRow, RemitoErrorRow } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DELIVERY_DATE = new Date('2026-05-20T00:00:00.000Z');
const CLIENT_ID = 42;

function makeMeasurement(overrides: Partial<MeasurementDataWithCount> = {}): MeasurementDataWithCount {
    return {
        id:            1,
        date:          DELIVERY_DATE,
        clientId:      CLIENT_ID,
        totalPackages: 5,
        ...overrides,
    };
}

function makeMeasurementError(overrides: Partial<MeasurementDataErrorRow> = {}): MeasurementDataErrorRow {
    return {
        id:         10,
        date:       DELIVERY_DATE,
        clientId:   CLIENT_ID,
        clientName: 'ACME S.A.',
        packages:   [{ quantity: 3 }, { quantity: 2 }],
        errors:     ['No se pudo identificar el cliente en el remito'],
        ...overrides,
    };
}

function makeRemito(overrides: Partial<RemitoRow> = {}): RemitoRow {
    return {
        id:         100,
        date:       DELIVERY_DATE,
        clientId:   CLIENT_ID,
        clientName: 'ACME S.A.',
        packages:   5,
        ...overrides,
    };
}

function makeRemitoError(overrides: Partial<RemitoErrorRow> = {}): RemitoErrorRow {
    return {
        id:         200,
        date:       DELIVERY_DATE,
        clientName: 'ACME S.A.',
        packages:   5,
        errors:     ['No se pudo identificar la dirección en el remito'],
        ...overrides,
    };
}

function makeCandidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
    return {
        clientId:         CLIENT_ID,
        deliveryDate:     DELIVERY_DATE,
        measurement:      makeMeasurement(),
        measurementError: null,
        remito:           makeRemito(),
        remitoError:      null,
        ...overrides,
    };
}

// ─── evaluateCandidate ────────────────────────────────────────────────────────

describe('evaluateCandidate', () => {

    // ── Happy path ────────────────────────────────────────────────────────────

    it('returns success when both sides are clean and package counts match', () => {
        const candidate = makeCandidate();
        const outcome = evaluateCandidate(candidate);

        expect(outcome.kind).toBe('success');
        expect(outcome.candidate).toBe(candidate);
    });

    it('attaches the original candidate to a success outcome', () => {
        const candidate = makeCandidate();
        const outcome = evaluateCandidate(candidate);

        expect(outcome.candidate.clientId).toBe(CLIENT_ID);
        expect(outcome.candidate.deliveryDate).toBe(DELIVERY_DATE);
    });

    // ── Package mismatch ──────────────────────────────────────────────────────

    it('returns error when measured packages differ from remito packages', () => {
        const candidate = makeCandidate({
            measurement: makeMeasurement({ totalPackages: 10 }),
            remito:      makeRemito({ packages: 13 }),
        });
        const outcome = evaluateCandidate(candidate);

        expect(outcome.kind).toBe('error');
        if (outcome.kind === 'error') {
            expect(outcome.errors).toHaveLength(1);
            expect(outcome.errors[0]).toContain('10');
            expect(outcome.errors[0]).toContain('13');
        }
    });

    it('error message mentions both the measured and declared counts', () => {
        const candidate = makeCandidate({
            measurement: makeMeasurement({ totalPackages: 3 }),
            remito:      makeRemito({ packages: 7 }),
        });
        const outcome = evaluateCandidate(candidate);

        if (outcome.kind === 'error') {
            expect(outcome.errors[0]).toMatch(/3/);
            expect(outcome.errors[0]).toMatch(/7/);
        }
    });

    it('counts match at boundary (0 = 0) → success', () => {
        const candidate = makeCandidate({
            measurement: makeMeasurement({ totalPackages: 0 }),
            remito:      makeRemito({ packages: 0 }),
        });
        const outcome = evaluateCandidate(candidate);

        expect(outcome.kind).toBe('success');
    });

    // ── Remito missing package count ──────────────────────────────────────────

    it('returns error when remito has null packages', () => {
        const candidate = makeCandidate({
            remito: makeRemito({ packages: null }),
        });
        const outcome = evaluateCandidate(candidate);

        expect(outcome.kind).toBe('error');
        if (outcome.kind === 'error') {
            expect(outcome.errors[0]).toContain('bultos');
        }
    });

    // ── Error side: MeasurementDataError ─────────────────────────────────────

    it('returns error when measurement side is a MeasurementDataError', () => {
        const candidate = makeCandidate({
            measurement:      null,
            measurementError: makeMeasurementError(),
        });
        const outcome = evaluateCandidate(candidate);

        expect(outcome.kind).toBe('error');
    });

    it('carries MeasurementDataError errors into the outcome', () => {
        const candidate = makeCandidate({
            measurement:      null,
            measurementError: makeMeasurementError({
                errors: ['Error de parseo A', 'Error de parseo B'],
            }),
        });
        const outcome = evaluateCandidate(candidate);

        if (outcome.kind === 'error') {
            expect(outcome.errors).toContain('Error de parseo A');
            expect(outcome.errors).toContain('Error de parseo B');
        }
    });

    // ── Error side: RemitoError ───────────────────────────────────────────────

    it('returns error when remito side is a RemitoError', () => {
        const candidate = makeCandidate({
            remito:      null,
            remitoError: makeRemitoError(),
        });
        const outcome = evaluateCandidate(candidate);

        expect(outcome.kind).toBe('error');
    });

    it('carries RemitoError errors into the outcome', () => {
        const candidate = makeCandidate({
            remito:      null,
            remitoError: makeRemitoError({
                errors: ['No se pudo identificar la dirección en el remito'],
            }),
        });
        const outcome = evaluateCandidate(candidate);

        if (outcome.kind === 'error') {
            expect(outcome.errors).toContain('No se pudo identificar la dirección en el remito');
        }
    });

    // ── Both sides are error records ──────────────────────────────────────────

    it('returns error when both sides are error records', () => {
        const candidate = makeCandidate({
            measurement:      null,
            measurementError: makeMeasurementError({ errors: ['Error medición'] }),
            remito:           null,
            remitoError:      makeRemitoError({ errors: ['Error remito'] }),
        });
        const outcome = evaluateCandidate(candidate);

        expect(outcome.kind).toBe('error');
    });

    it('merges errors from both error sides', () => {
        const candidate = makeCandidate({
            measurement:      null,
            measurementError: makeMeasurementError({ errors: ['Error medición'] }),
            remito:           null,
            remitoError:      makeRemitoError({ errors: ['Error remito'] }),
        });
        const outcome = evaluateCandidate(candidate);

        if (outcome.kind === 'error') {
            expect(outcome.errors).toContain('Error medición');
            expect(outcome.errors).toContain('Error remito');
        }
    });

    // ── Mixed: clean measurement + error remito ───────────────────────────────

    it('returns error when measurement is clean but remito side has errors', () => {
        const candidate = makeCandidate({
            measurement:  makeMeasurement(),
            remito:       null,
            remitoError:  makeRemitoError({ errors: ['Dirección inválida'] }),
        });
        const outcome = evaluateCandidate(candidate);

        expect(outcome.kind).toBe('error');
        if (outcome.kind === 'error') {
            expect(outcome.errors).toContain('Dirección inválida');
        }
    });

    it('returns error when remito is clean but measurement side has errors', () => {
        const candidate = makeCandidate({
            measurement:      null,
            measurementError: makeMeasurementError({ errors: ['Formato inválido'] }),
            remito:           makeRemito(),
        });
        const outcome = evaluateCandidate(candidate);

        expect(outcome.kind).toBe('error');
        if (outcome.kind === 'error') {
            expect(outcome.errors).toContain('Formato inválido');
        }
    });
});

// ─── evaluateCandidates (batch) ───────────────────────────────────────────────

describe('evaluateCandidates', () => {
    it('returns an empty array for empty input', () => {
        expect(evaluateCandidates([])).toEqual([]);
    });

    it('returns one outcome per candidate', () => {
        const candidates = [
            makeCandidate({ clientId: 1 }),
            makeCandidate({ clientId: 2 }),
            makeCandidate({ clientId: 3 }),
        ];
        const outcomes = evaluateCandidates(candidates);

        expect(outcomes).toHaveLength(3);
    });

    it('evaluates each candidate independently', () => {
        const candidates = [
            makeCandidate({ measurement: makeMeasurement({ totalPackages: 5 }), remito: makeRemito({ packages: 5 }) }),
            makeCandidate({ measurement: makeMeasurement({ totalPackages: 3 }), remito: makeRemito({ packages: 9 }) }),
        ];
        const outcomes = evaluateCandidates(candidates);

        expect(outcomes[0].kind).toBe('success');
        expect(outcomes[1].kind).toBe('error');
    });

    it('handles a mix of all outcome types in one batch', () => {
        const candidates = [
            // success
            makeCandidate({ clientId: 1 }),
            // package mismatch
            makeCandidate({ clientId: 2, measurement: makeMeasurement({ totalPackages: 1 }), remito: makeRemito({ packages: 9 }) }),
            // error side
            makeCandidate({ clientId: 3, measurement: null, measurementError: makeMeasurementError() }),
        ];
        const outcomes = evaluateCandidates(candidates);

        expect(outcomes.filter(o => o.kind === 'success')).toHaveLength(1);
        expect(outcomes.filter(o => o.kind === 'error')).toHaveLength(2);
    });
});