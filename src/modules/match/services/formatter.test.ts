import { formatMatchRunCsv, formatMatchRunSummary } from './formatter';
import { MatchRunResult, MatchCandidate, MatchOutcome } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DELIVERY_DATE = new Date('2026-05-20T00:00:00.000Z');
const CLIENT_ID = 7;

function makeCandidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
    return {
        clientId:         CLIENT_ID,
        deliveryDate:     DELIVERY_DATE,
        measurement:      { id: 1, date: DELIVERY_DATE, clientId: CLIENT_ID, totalPackages: 5 },
        measurementError: null,
        remito:           { id: 100, date: DELIVERY_DATE, clientId: CLIENT_ID, clientName: 'ACME', packages: 5 },
        remitoError:      null,
        ...overrides,
    };
}

function makeResult(overrides: Partial<MatchRunResult> = {}): MatchRunResult {
    return {
        ranAt:        new Date('2026-05-20T06:00:00.000Z'),
        successCount: 0,
        errorCount:   0,
        skippedCount: 0,
        outcomes:     [],
        ...overrides,
    };
}

// ─── formatMatchRunCsv ────────────────────────────────────────────────────────

describe('formatMatchRunCsv', () => {

    it('always includes the header row', () => {
        const csv = formatMatchRunCsv(makeResult());
        const lines = csv.split('\n');

        expect(lines[0]).toContain('Fecha entrega');
        expect(lines[0]).toContain('Cliente ID');
        expect(lines[0]).toContain('Resultado');
        expect(lines[0]).toContain('Bultos medidos');
        expect(lines[0]).toContain('Bultos remito');
        expect(lines[0]).toContain('Errores');
    });

    it('produces only a header row when there are no outcomes', () => {
        const csv = formatMatchRunCsv(makeResult());
        const lines = csv.split('\n').filter(l => l.length > 0);
        expect(lines).toHaveLength(1);
    });

    it('produces header + one data row for a single success', () => {
        const outcome: MatchOutcome = { kind: 'success', candidate: makeCandidate() };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome], successCount: 1 }));
        const lines = csv.split('\n').filter(l => l.length > 0);
        expect(lines).toHaveLength(2);
    });

    it('marks successful outcomes as OK', () => {
        const outcome: MatchOutcome = { kind: 'success', candidate: makeCandidate() };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }));
        expect(csv).toContain('OK');
    });

    it('marks error outcomes as ERROR', () => {
        const outcome: MatchOutcome = {
            kind:      'error',
            candidate: makeCandidate(),
            errors:    ['Discrepancia'],
        };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }));
        expect(csv).toContain('ERROR');
    });

    it('includes the clientId in each data row', () => {
        const outcome: MatchOutcome = { kind: 'success', candidate: makeCandidate({ clientId: 42 }) };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }));
        expect(csv).toContain('42');
    });

    it('includes measured and remito package counts', () => {
        const outcome: MatchOutcome = {
            kind:      'success',
            candidate: makeCandidate({
                measurement: { id: 1, date: DELIVERY_DATE, clientId: CLIENT_ID, totalPackages: 10 },
                remito:      { id: 100, date: DELIVERY_DATE, clientId: CLIENT_ID, clientName: 'ACME', packages: 10 },
            }),
        };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }));
        const dataRow = csv.split('\n')[1];
        expect(dataRow).toContain('10');
    });

    it('includes error messages joined by " | " in the errors column', () => {
        const outcome: MatchOutcome = {
            kind:      'error',
            candidate: makeCandidate(),
            errors:    ['Error A', 'Error B'],
        };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }));
        expect(csv).toContain('Error A | Error B');
    });

    it('leaves the errors column empty for successful outcomes', () => {
        const outcome: MatchOutcome = { kind: 'success', candidate: makeCandidate() };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }));
        const dataRow = csv.split('\n')[1];
        // Last column should be empty (trailing comma or nothing after last comma)
        expect(dataRow.endsWith(',')).toBe(true);
    });

    it('quotes cells that contain commas', () => {
        const outcome: MatchOutcome = {
            kind:      'error',
            candidate: makeCandidate(),
            errors:    ['se midieron 3, declararon 7'],
        };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }));
        // The comma-containing value should be wrapped in quotes
        expect(csv).toContain('"se midieron 3, declararon 7"');
    });

    it('includes the MeasurementData ID when present', () => {
        const outcome: MatchOutcome = {
            kind:      'success',
            candidate: makeCandidate({ measurement: { id: 99, date: DELIVERY_DATE, clientId: CLIENT_ID, totalPackages: 5 } }),
        };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }));
        expect(csv).toContain('99');
    });

    it('leaves measurement ID column empty when measurement side is an error record', () => {
        const outcome: MatchOutcome = {
            kind:      'error',
            candidate: makeCandidate({
                measurement:      null,
                measurementError: { id: 10, date: DELIVERY_DATE, clientId: CLIENT_ID, clientName: 'ACME', packages: null, errors: [] },
            }),
            errors: [],
        };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }));
        const dataRow = csv.split('\n')[1];
        const cols = dataRow.split(',');
        // ID MeasurementData column (index 5) should be empty, ID MeasurementDataError (index 6) should be '10'
        expect(cols[5]).toBe('');
        expect(cols[6]).toBe('10');
    });
});

// ─── formatMatchRunSummary ────────────────────────────────────────────────────

describe('formatMatchRunSummary', () => {
    it('includes the success count', () => {
        const result = makeResult({ successCount: 12, errorCount: 3, skippedCount: 1 });
        expect(formatMatchRunSummary(result)).toContain('12');
    });

    it('includes the error count', () => {
        const result = makeResult({ successCount: 0, errorCount: 5, skippedCount: 0 });
        expect(formatMatchRunSummary(result)).toContain('5');
    });

    it('includes the skipped count', () => {
        const result = makeResult({ successCount: 0, errorCount: 0, skippedCount: 8 });
        expect(formatMatchRunSummary(result)).toContain('8');
    });

    it('contains a WhatsApp-bold header with Remito', () => {
        const result = makeResult();
        const summary = formatMatchRunSummary(result);
        expect(summary).toContain('*');
        expect(summary.toLowerCase()).toContain('match');
    });

    it('mentions that the CSV is attached when there are outcomes', () => {
        const outcome: MatchOutcome = { kind: 'success', candidate: makeCandidate() };
        const result = makeResult({ outcomes: [outcome], successCount: 1 });
        const summary = formatMatchRunSummary(result);
        expect(summary.toLowerCase()).toContain('csv');
    });

    it('does not mention CSV when there are no outcomes', () => {
        const result = makeResult();
        const summary = formatMatchRunSummary(result);
        expect(summary.toLowerCase()).not.toContain('csv');
    });
});