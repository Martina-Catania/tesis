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

        expect(lines[0]).toContain('Cliente');
        expect(lines[0]).toContain('Dirección');
        expect(lines[0]).toContain('Zona');
        expect(lines[0]).toContain('Bultos');
        expect(lines[0]).toContain('Vol (m3)');
        expect(lines[0]).toContain('Tarifa');
        expect(lines[0]).toContain('Observaciones');
    });

    it('can omit the header row for append-only writes', () => {
        const outcome: MatchOutcome = { kind: 'success', candidate: makeCandidate() };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }), { includeHeader: false });
        const lines = csv.split('\n').filter(l => l.length > 0);

        expect(lines).toHaveLength(1);
        expect(lines[0]).not.toContain('Cliente');
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

    it('includes the client name in each data row', () => {
        const outcome: MatchOutcome = { kind: 'success', candidate: makeCandidate() };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }));
        expect(csv).toContain('ACME');
    });

    it('includes the remito address and zone when present', () => {
        const outcome: MatchOutcome = {
            kind: 'success',
            candidate: makeCandidate({
                remito: { id: 100, date: DELIVERY_DATE, clientId: CLIENT_ID, clientName: 'ACME', address: 'Av. Corrientes 1234', zone: 'CABA', packages: 5 },
            }),
        };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }));
        expect(csv).toContain('Av. Corrientes 1234');
        expect(csv).toContain('CABA');
    });

    it('formats bultos, volume, and tariff columns', () => {
        const outcome: MatchOutcome = {
            kind: 'success',
            candidate: makeCandidate({
                measurement: { id: 1, date: DELIVERY_DATE, clientId: CLIENT_ID, totalPackages: 10, volumeM3: 1.25 },
                tariff: 3200.5,
            }),
        };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }));
        expect(csv).toContain('10');
        expect(csv).toContain('1.25');
        expect(csv).toContain('3200.5');
    });

    it('puts error messages in the observaciones column', () => {
        const outcome: MatchOutcome = {
            kind:      'error',
            candidate: makeCandidate(),
            errors:    ['Discrepancia'],
        };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }));
        expect(csv).toContain('Discrepancia');
    });

    it('leaves observaciones empty for successful outcomes', () => {
        const outcome: MatchOutcome = { kind: 'success', candidate: makeCandidate() };
        const csv = formatMatchRunCsv(makeResult({ outcomes: [outcome] }));
        const dataRow = csv.split('\n')[1];
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