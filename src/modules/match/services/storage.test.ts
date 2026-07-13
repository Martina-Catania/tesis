import { mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import {
    getLastRunAt,
    setLastRunAt,
    fetchUnmatchedMeasurements,
    fetchUnmatchedRemitos,
    groupIntoCandidates,
    saveDeliveryMatch,
    saveDeliveryError,
} from './storage';
import {
    MeasurementDataWithCount,
    MeasurementDataErrorRow,
    RemitoRow,
    RemitoErrorRow,
    MatchCandidate,
} from '../types';

// ─── Setup ────────────────────────────────────────────────────────────────────

const prismaMock = mockDeep<PrismaClient>();

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => { });
    jest.spyOn(console, 'warn').mockImplementation(() => { });
    mockReset(prismaMock);
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DATE_A = new Date('2026-05-20T10:30:00.000Z'); // same calendar day
const DATE_A2 = new Date('2026-05-20T18:00:00.000Z'); // same calendar day, different time
const DATE_B = new Date('2026-05-21T09:00:00.000Z'); // different calendar day
const CLIENT_1 = 1;
const CLIENT_2 = 2;

function meas(id: number, clientId: number, date: Date, totalPackages = 5): MeasurementDataWithCount {
    return { id, date, clientId, totalPackages };
}

function measErr(id: number, clientId: number | null, date: Date, errors: string[] = ['parse error']): MeasurementDataErrorRow {
    return { id, date, clientId, clientName: 'ACME', packages: [{ quantity: 3 }], errors };
}

function rem(id: number, clientId: number, date: Date, packages: number | null = 5): RemitoRow {
    return { id, date, clientId, clientName: 'ACME', packages };
}

function remErr(id: number, clientName: string, date: Date, errors: string[] = ['parse error']): RemitoErrorRow {
    return { id, date, clientName, packages: 5, errors };
}

const noOp = (_name: string): number | undefined => undefined;
const resolverFor = (name: string, id: number) => (n: string) => n === name ? id : undefined;

// ─── getLastRunAt ─────────────────────────────────────────────────────────────

describe('getLastRunAt', () => {
    it('returns null when the MatchRunLog table is empty', async () => {
        prismaMock.matchRunLog.findUnique.mockResolvedValue(null);
        const result = await getLastRunAt(prismaMock);
        expect(result).toBeNull();
    });

    it('returns the stored timestamp when it exists', async () => {
        const ts = new Date('2026-05-19T06:00:00.000Z');
        prismaMock.matchRunLog.findUnique.mockResolvedValue({ id: 1, lastRunAt: ts });
        const result = await getLastRunAt(prismaMock);
        expect(result).toEqual(ts);
    });
});

// ─── setLastRunAt ─────────────────────────────────────────────────────────────

describe('setLastRunAt', () => {
    it('upserts the run log with the given timestamp', async () => {
        const ts = new Date('2026-05-20T06:00:00.000Z');
        prismaMock.matchRunLog.upsert.mockResolvedValue({ id: 1, lastRunAt: ts });

        await setLastRunAt(prismaMock, ts);

        expect(prismaMock.matchRunLog.upsert).toHaveBeenCalledWith({
            where:  { id: 1 },
            update: { lastRunAt: ts },
            create: { id: 1, lastRunAt: ts },
        });
    });
});

// ─── fetchUnmatchedMeasurements / fetchUnmatchedRemitos ─────────────────────

describe('fetchUnmatchedMeasurements', () => {
    it('excludes measurements already stored in DeliveryError', async () => {
        prismaMock.deliveryError.findMany.mockResolvedValue([
            { measurementDataId: 11 },
        ] as any);
        prismaMock.measurementData.findMany.mockResolvedValue([] as any);

        await fetchUnmatchedMeasurements(prismaMock);

        expect(prismaMock.measurementData.findMany).toHaveBeenCalledWith({
            where: {
                match: null,
                clientId: { not: 0 },
                NOT: { id: { in: [11] } },
            },
            include: {
                packages: { select: { quantity: true, volume: true } },
            },
        });
    });
});

describe('fetchUnmatchedRemitos', () => {
    it('excludes remitos already stored in DeliveryError', async () => {
        prismaMock.deliveryError.findMany.mockResolvedValue([
            { remitoId: 21 },
        ] as any);
        prismaMock.remito.findMany.mockResolvedValue([] as any);

        await fetchUnmatchedRemitos(prismaMock);

        expect(prismaMock.remito.findMany).toHaveBeenCalledWith({
            where: {
                match: null,
                clientId: { not: null },
                NOT: { id: { in: [21] } },
            },
            include: {
                resolvedAddress: {
                    select: { address: true, zone: true },
                },
            },
        });
    });
});

// ─── groupIntoCandidates ──────────────────────────────────────────────────────

describe('groupIntoCandidates', () => {

    // ── Basic pairing ─────────────────────────────────────────────────────────

    it('pairs a MeasurementData with a Remito on the same client+day', () => {
        const { candidates } = groupIntoCandidates(
            [meas(1, CLIENT_1, DATE_A)],
            [],
            [rem(100, CLIENT_1, DATE_A)],
            [],
            noOp,
        );

        expect(candidates).toHaveLength(1);
        expect(candidates[0].measurement?.id).toBe(1);
        expect(candidates[0].remito?.id).toBe(100);
    });

    it('pairs a MeasurementDataError with a Remito on the same client+day', () => {
        const { candidates } = groupIntoCandidates(
            [],
            [measErr(10, CLIENT_1, DATE_A)],
            [rem(100, CLIENT_1, DATE_A)],
            [],
            noOp,
        );

        expect(candidates).toHaveLength(1);
        expect(candidates[0].measurementError?.id).toBe(10);
        expect(candidates[0].remito?.id).toBe(100);
        expect(candidates[0].measurement).toBeNull();
    });

    it('pairs a MeasurementData with a RemitoError (resolved by name)', () => {
        const resolver = resolverFor('ACME', CLIENT_1);
        const { candidates } = groupIntoCandidates(
            [meas(1, CLIENT_1, DATE_A)],
            [],
            [],
            [remErr(200, 'ACME', DATE_A)],
            resolver,
        );

        expect(candidates).toHaveLength(1);
        expect(candidates[0].measurement?.id).toBe(1);
        expect(candidates[0].remitoError?.id).toBe(200);
    });

    // ── Time-of-day normalisation ──────────────────────────────────────────────

    it('matches records from the same calendar day regardless of time-of-day', () => {
        const { candidates } = groupIntoCandidates(
            [meas(1, CLIENT_1, DATE_A)],   // 10:30 UTC
            [],
            [rem(100, CLIENT_1, DATE_A2)], // 18:00 UTC — same day
            [],
            noOp,
        );

        expect(candidates).toHaveLength(1);
    });

    // ── Different days are not paired ─────────────────────────────────────────

    it('does not pair records from different calendar days', () => {
        const { candidates, skippedCount } = groupIntoCandidates(
            [meas(1, CLIENT_1, DATE_A)],
            [],
            [rem(100, CLIENT_1, DATE_B)], // different day
            [],
            noOp,
        );

        expect(candidates).toHaveLength(0);
        expect(skippedCount).toBe(2); // both sides skipped
    });

    // ── Different clients are not paired ──────────────────────────────────────

    it('does not pair records from different clients on the same day', () => {
        const { candidates } = groupIntoCandidates(
            [meas(1, CLIENT_1, DATE_A)],
            [],
            [rem(100, CLIENT_2, DATE_A)], // different client
            [],
            noOp,
        );

        expect(candidates).toHaveLength(0);
    });

    // ── Multiple independent pairs ────────────────────────────────────────────

    it('correctly produces two independent candidates from two client+day pairs', () => {
        const { candidates } = groupIntoCandidates(
            [meas(1, CLIENT_1, DATE_A), meas(2, CLIENT_2, DATE_A)],
            [],
            [rem(100, CLIENT_1, DATE_A), rem(101, CLIENT_2, DATE_A)],
            [],
            noOp,
        );

        expect(candidates).toHaveLength(2);
        const clientIds = candidates.map(c => c.clientId).sort();
        expect(clientIds).toEqual([CLIENT_1, CLIENT_2]);
    });

    it('counts extra measurements for the same client+day as skipped', () => {
        const { candidates, skippedCount } = groupIntoCandidates(
            [meas(1, CLIENT_1, DATE_A, 4), meas(2, CLIENT_1, DATE_A, 6)],
            [],
            [rem(100, CLIENT_1, DATE_A)],
            [],
            noOp,
        );

        expect(candidates).toHaveLength(1);
        expect(candidates[0].measurement?.id).toBe(2);
        expect(skippedCount).toBe(1);
    });

    // ── Skipped (only one side present) ───────────────────────────────────────

    it('skips when measurement has no matching remito', () => {
        const { candidates, skippedCount } = groupIntoCandidates(
            [meas(1, CLIENT_1, DATE_A)],
            [],
            [], // no remito
            [],
            noOp,
        );

        expect(candidates).toHaveLength(0);
        expect(skippedCount).toBe(1);
    });

    it('skips when remito has no matching measurement', () => {
        const { candidates, skippedCount } = groupIntoCandidates(
            [],
            [],
            [rem(100, CLIENT_1, DATE_A)],
            [],
            noOp,
        );

        expect(candidates).toHaveLength(0);
        expect(skippedCount).toBe(1);
    });

    it('skips RemitoError rows whose clientName cannot be resolved', () => {
        const { candidates, skippedCount } = groupIntoCandidates(
            [meas(1, CLIENT_1, DATE_A)],
            [],
            [],
            [remErr(200, 'Unknown Corp', DATE_A)],
            noOp, // always returns undefined
        );

        expect(candidates).toHaveLength(0);
        expect(skippedCount).toBeGreaterThan(0);
    });

    // ── deliveryDate normalisation ────────────────────────────────────────────

    it('sets deliveryDate to midnight UTC for the calendar day', () => {
        const { candidates } = groupIntoCandidates(
            [meas(1, CLIENT_1, DATE_A)], // 10:30 UTC
            [],
            [rem(100, CLIENT_1, DATE_A)],
            [],
            noOp,
        );

        expect(candidates[0].deliveryDate.getUTCHours()).toBe(0);
        expect(candidates[0].deliveryDate.getUTCMinutes()).toBe(0);
        expect(candidates[0].deliveryDate.getUTCSeconds()).toBe(0);
    });
});

// ─── saveDeliveryMatch ────────────────────────────────────────────────────────

describe('saveDeliveryMatch', () => {
    const candidate: MatchCandidate = {
        clientId:         CLIENT_1,
        deliveryDate:     new Date('2026-05-20T00:00:00.000Z'),
        measurement:      meas(1, CLIENT_1, DATE_A, 5),
        measurementError: null,
        remito:           rem(100, CLIENT_1, DATE_A, 5),
        remitoError:      null,
    };

    it('calls prisma.deliveryMatch.create with the correct fields', async () => {
        prismaMock.deliveryMatch.create.mockResolvedValue({} as any);

        await saveDeliveryMatch(prismaMock, candidate);

        expect(prismaMock.deliveryMatch.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                measurementDataId: 1,
                remitoId:          100,
                clientId:          CLIENT_1,
                measuredPackages:  5,
                remitoPackages:    5,
            }),
        });
    });

    it('throws if measurement is null', async () => {
        const badCandidate = { ...candidate, measurement: null };
        await expect(saveDeliveryMatch(prismaMock, badCandidate)).rejects.toThrow();
    });

    it('throws if remito is null', async () => {
        const badCandidate = { ...candidate, remito: null };
        await expect(saveDeliveryMatch(prismaMock, badCandidate)).rejects.toThrow();
    });
});

// ─── saveDeliveryError ────────────────────────────────────────────────────────

describe('saveDeliveryError', () => {
    it('saves with measurementDataId when measurement side is clean', async () => {
        prismaMock.deliveryError.create.mockResolvedValue({} as any);

        const candidate: MatchCandidate = {
            clientId:         CLIENT_1,
            deliveryDate:     new Date('2026-05-20T00:00:00.000Z'),
            measurement:      meas(1, CLIENT_1, DATE_A, 10),
            measurementError: null,
            remito:           null,
            remitoError:      remErr(200, 'ACME', DATE_A, ['bad address']),
        };

        await saveDeliveryError(prismaMock, candidate, ['bad address']);

        expect(prismaMock.deliveryError.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                measurementDataId:      1,
                measurementDataErrorId: null,
                remitoId:               null,
                remitoErrorId:          200,
                measuredPackages:       10,
                errors:                 ['bad address'],
            }),
        });
    });

    it('saves with measurementDataErrorId when measurement side has errors', async () => {
        prismaMock.deliveryError.create.mockResolvedValue({} as any);

        const candidate: MatchCandidate = {
            clientId:         CLIENT_1,
            deliveryDate:     new Date('2026-05-20T00:00:00.000Z'),
            measurement:      null,
            measurementError: measErr(10, CLIENT_1, DATE_A, ['parse error']),
            remito:           rem(100, CLIENT_1, DATE_A, 5),
            remitoError:      null,
        };

        await saveDeliveryError(prismaMock, candidate, ['parse error']);

        expect(prismaMock.deliveryError.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                measurementDataId:      null,
                measurementDataErrorId: 10,
                remitoId:               100,
                remitoErrorId:          null,
            }),
        });
    });

    it('saves with both error IDs when both sides are error records', async () => {
        prismaMock.deliveryError.create.mockResolvedValue({} as any);

        const candidate: MatchCandidate = {
            clientId:         CLIENT_1,
            deliveryDate:     new Date('2026-05-20T00:00:00.000Z'),
            measurement:      null,
            measurementError: measErr(10, CLIENT_1, DATE_A, ['error A']),
            remito:           null,
            remitoError:      remErr(200, 'ACME', DATE_A, ['error B']),
        };

        await saveDeliveryError(prismaMock, candidate, ['error A', 'error B']);

        expect(prismaMock.deliveryError.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                measurementDataErrorId: 10,
                remitoErrorId:          200,
            }),
        });
    });

    it('passes the errors array through to the DB', async () => {
        prismaMock.deliveryError.create.mockResolvedValue({} as any);

        const errors = ['Discrepancia en cantidad de bultos', 'Error adicional'];
        const candidate: MatchCandidate = {
            clientId:         CLIENT_1,
            deliveryDate:     new Date('2026-05-20T00:00:00.000Z'),
            measurement:      meas(1, CLIENT_1, DATE_A, 3),
            measurementError: null,
            remito:           rem(100, CLIENT_1, DATE_A, 7),
            remitoError:      null,
        };

        await saveDeliveryError(prismaMock, candidate, errors);

        expect(prismaMock.deliveryError.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ errors }),
        });
    });

    it('sets measuredPackages to null when no package data is available', async () => {
        prismaMock.deliveryError.create.mockResolvedValue({} as any);

        const candidate: MatchCandidate = {
            clientId:         CLIENT_1,
            deliveryDate:     new Date('2026-05-20T00:00:00.000Z'),
            measurement:      null,
            measurementError: measErr(10, CLIENT_1, DATE_A),
            remito:           rem(100, CLIENT_1, DATE_A),
            remitoError:      null,
        };

        // Override packages to null
        candidate.measurementError!.packages = null;

        await saveDeliveryError(prismaMock, candidate, ['no packages']);

        expect(prismaMock.deliveryError.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ measuredPackages: null }),
        });
    });
});