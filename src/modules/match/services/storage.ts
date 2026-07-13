// @ts-nocheck

import { PrismaClient } from '@prisma/client';
import {
    MeasurementDataWithCount,
    MeasurementDataErrorRow,
    RemitoRow,
    RemitoErrorRow,
    MatchCandidate,
} from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns midnight UTC for the calendar date of a given DateTime. */
function toDateOnly(dt: Date): Date {
    const d = new Date(dt);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

/** ISO date string (YYYY-MM-DD) used as a grouping key. */
function dateKey(dt: Date): string {
    return toDateOnly(dt).toISOString().slice(0, 10);
}

// ─── Last-run timestamp ───────────────────────────────────────────────────────

/**
 * Returns the timestamp of the last successful match run, or null if it has
 * never run. There is at most one row in MatchRunLog (id = 1).
 */
export async function getLastRunAt(prisma: PrismaClient): Promise<Date | null> {
    const row = await prisma.matchRunLog.findUnique({ where: { id: 1 } });
    return row?.lastRunAt ?? null;
}

/**
 * Upserts the single MatchRunLog row to record a completed run.
 */
export async function setLastRunAt(prisma: PrismaClient, ranAt: Date): Promise<void> {
    await prisma.matchRunLog.upsert({
        where:  { id: 1 },
        update: { lastRunAt: ranAt },
        create: { id: 1, lastRunAt: ranAt },
    });
}

// ─── Fetch unmatched records ──────────────────────────────────────────────────

/**
 * Returns all MeasurementData rows that have no DeliveryMatch yet,
 * each annotated with the total package count across its Package children.
 */
export async function fetchUnmatchedMeasurements(
    prisma: PrismaClient,
): Promise<MeasurementDataWithCount[]> {
    const usedIds = await prisma.deliveryError
        .findMany({
            where:  { measurementDataId: { not: null } },
            select: { measurementDataId: true },
        })
        .then(rows => rows.map(r => r.measurementDataId as number));

    const rows = await prisma.measurementData.findMany({
        where: {
            match: null,         // no DeliveryMatch yet
            clientId: { not: 0 }, // always has a clientId
            ...(usedIds.length > 0 ? { NOT: { id: { in: usedIds } } } : {}),
        },
        include: {
            packages: { select: { quantity: true, volume: true } },
        },
    });

    return rows.map(r => ({
        id:            r.id,
        date:          r.date,
        clientId:      r.clientId,
        periodId:      r.periodId,
        totalPackages: r.packages.reduce((sum, p) => sum + p.quantity, 0),
        volumeM3:      r.packages.reduce((sum, p) => sum + (p.volume * p.quantity), 0) / 1_000_000,
    }));
}

/**
 * Returns all MeasurementDataError rows that are not yet referenced by any
 * DeliveryError as the measurement side.
 */
export async function fetchUnmatchedMeasurementErrors(
    prisma: PrismaClient,
): Promise<MeasurementDataErrorRow[]> {
    const rows = await prisma.measurementDataError.findMany({
        where: {
            clientId: { not: null }, // only attempt when we have at least a clientId
            // exclude rows already consumed by a DeliveryError
            NOT: {
                id: {
                    in: await prisma.deliveryError
                        .findMany({
                            where:  { measurementDataErrorId: { not: null } },
                            select: { measurementDataErrorId: true },
                        })
                        .then(rows => rows.map(r => r.measurementDataErrorId as number)),
                },
            },
        },
    });

    return rows.map(r => ({
        id:         r.id,
        date:       r.date,
        clientId:   r.clientId,
        clientName: r.clientName,
        address:    r.address,
        packages:   parseJsonPackages(r.packages),
        errors:     parseJsonErrors(r.errors),
    }));
}

/**
 * Returns all Remito rows that have no DeliveryMatch yet and have a resolved
 * clientId (only matchable records).
 */
export async function fetchUnmatchedRemitos(
    prisma: PrismaClient,
): Promise<RemitoRow[]> {
    const usedIds = await prisma.deliveryError
        .findMany({
            where:  { remitoId: { not: null } },
            select: { remitoId: true },
        })
        .then(rows => rows.map(r => r.remitoId as number));

    const rows = await prisma.remito.findMany({
        where: {
            match:    null,         // no DeliveryMatch yet
            clientId: { not: null }, // must have a resolved clientId to be matchable
            ...(usedIds.length > 0 ? { NOT: { id: { in: usedIds } } } : {}),
        },
        include: {
            resolvedAddress: {
                select: { address: true, zone: true },
            },
        },
    });

    return rows.map(r => ({
        id:         r.id,
        date:       r.date,
        clientId:   r.clientId,
        clientName: r.clientName,
        address:    r.address,
        zone:       r.resolvedAddress?.zone ?? null,
        packages:   r.packages,
    }));
}

/**
 * Returns all RemitoError rows that are not yet referenced by any DeliveryError
 * as the remito side, and whose clientName is non-null (needed to group by client).
 *
 * Note: RemitoError has no clientId FK, so we match on clientName.
 * The matcher layer will resolve the name to a clientId via the Client table.
 */
export async function fetchUnmatchedRemitoErrors(
    prisma: PrismaClient,
): Promise<RemitoErrorRow[]> {
    const usedIds = await prisma.deliveryError
        .findMany({
            where:  { remitoErrorId: { not: null } },
            select: { remitoErrorId: true },
        })
        .then(rows => rows.map(r => r.remitoErrorId as number));

    const rows = await prisma.remitoError.findMany({
        where: {
            clientName: { not: null },
            ...(usedIds.length > 0 ? { NOT: { id: { in: usedIds } } } : {}),
        },
    });

    return rows.map(r => ({
        id:         r.id,
        date:       r.date,
        clientName: r.clientName,
        address:    r.address,
        packages:   r.packages,
        errors:     parseJsonErrors(r.errors),
    }));
}

// ─── Group into candidates ────────────────────────────────────────────────────

/**
 * Groups the four lists of unmatched records into MatchCandidate objects,
 * keyed by (clientId, calendar-day). A candidate is only returned when BOTH
 * sides (measurement + remito) are present — if only one side exists we skip
 * it (the other side may arrive later).
 *
 * RemitoErrors are matched by clientName → clientId lookup supplied by the
 * caller (resolveClientId).
 */
export function groupIntoCandidates(
    measurements:       MeasurementDataWithCount[],
    measurementErrors:  MeasurementDataErrorRow[],
    remitos:            RemitoRow[],
    remitoErrors:       RemitoErrorRow[],
    resolveClientId:    (name: string) => number | undefined,
    resolveTariff:      (input: { periodId: number | null | undefined; zone: string | null | undefined; volumeM3: number | null | undefined }) => number | null | undefined = () => undefined,
): { candidates: MatchCandidate[]; skippedCount: number } {

    // ── Index measurement-side records by "clientId|date" ────────────────────
    const measMap  = new Map<string, MeasurementDataWithCount[]>();
    const meErrMap = new Map<string, MeasurementDataErrorRow[]>();

    for (const m of measurements) {
        append(measMap, candidateKey(m.clientId, m.date), m);
    }
    for (const me of measurementErrors) {
        if (me.clientId === null) continue;
        append(meErrMap, candidateKey(me.clientId, me.date), me);
    }

    // ── Index remito-side records by "clientId|date" ─────────────────────────
    const remMap   = new Map<string, RemitoRow[]>();
    const reErrMap = new Map<string, RemitoErrorRow[]>();

    for (const r of remitos) {
        if (r.clientId === null) continue;
        append(remMap, candidateKey(r.clientId, r.date), r);
    }
    for (const re of remitoErrors) {
        const cid = re.clientName ? resolveClientId(re.clientName) : undefined;
        if (cid === undefined) continue;
        append(reErrMap, candidateKey(cid, re.date), re);
    }

    // ── Collect all keys where BOTH sides are present ────────────────────────
    const allKeys = new Set([
        ...measMap.keys(),
        ...meErrMap.keys(),
    ]);

    const candidates: MatchCandidate[] = [];
    let skippedCount = 0;

    for (const key of allKeys) {
        const measurementsForKey      = measMap.get(key)  ?? [];
        const measurementErrorsForKey = meErrMap.get(key) ?? [];
        const remitosForKey           = remMap.get(key)   ?? [];
        const remitoErrorsForKey      = reErrMap.get(key) ?? [];

        const measurement      = last(measurementsForKey);
        const measurementError = last(measurementErrorsForKey);
        const remito           = last(remitosForKey);
        const remitoError      = last(remitoErrorsForKey);

        // Only proceed if the remito side is also present
        if (remito === null && remitoError === null) {
            skippedCount += measurementsForKey.length + measurementErrorsForKey.length;
            continue;
        }

        if (measurement === null && measurementError === null) {
            skippedCount += remitosForKey.length + remitoErrorsForKey.length;
            continue;
        }

        skippedCount += Math.max(0, measurementsForKey.length - (measurement ? 1 : 0));
        skippedCount += Math.max(0, measurementErrorsForKey.length - (measurementError ? 1 : 0));
        skippedCount += Math.max(0, remitosForKey.length - (remito ? 1 : 0));
        skippedCount += Math.max(0, remitoErrorsForKey.length - (remitoError ? 1 : 0));

        const [clientIdStr, dateStr] = key.split('|');
        const volumeM3 = measurement?.volumeM3 ?? null;
        const tariff = resolveTariff({
            periodId: measurement?.periodId ?? null,
            zone: remito?.zone ?? null,
            volumeM3,
        }) ?? null;

        candidates.push({
            clientId:     parseInt(clientIdStr, 10),
            deliveryDate: new Date(dateStr + 'T00:00:00.000Z'),
            tariff,
            measurement,
            measurementError,
            remito,
            remitoError,
        });
    }

    // Also check for remito-side keys with no measurement side (skipped)
    const remitosOnlyKeys = new Set([
        ...remMap.keys(),
        ...reErrMap.keys(),
    ]);
    for (const key of remitosOnlyKeys) {
        if (!allKeys.has(key)) {
            skippedCount++;
        }
    }

    return { candidates, skippedCount };
}

function append<T>(map: Map<string, T[]>, key: string, value: T): void {
    const values = map.get(key) ?? [];
    values.push(value);
    map.set(key, values);
}

function last<T>(values: T[]): T | null {
    return values.length > 0 ? values[values.length - 1] : null;
}

// ─── Persist outcomes ─────────────────────────────────────────────────────────

/**
 * Persists a successful match.
 */
export async function saveDeliveryMatch(
    prisma: PrismaClient,
    candidate: MatchCandidate,
): Promise<void> {
    const { measurement, remito } = candidate;
    if (!measurement || !remito) {
        throw new Error('[Matching Storage] saveDeliveryMatch called with missing measurement or remito');
    }

    console.log(
        `[Matching Storage] Saving DeliveryMatch — ` +
        `clientId: ${candidate.clientId}, date: ${candidate.deliveryDate.toISOString().slice(0, 10)}, ` +
        `measurementDataId: ${measurement.id}, remitoId: ${remito.id}`,
    );

    await prisma.deliveryMatch.create({
        data: {
            measurementDataId: measurement.id,
            remitoId:          remito.id,
            clientId:          candidate.clientId,
            deliveryDate:      candidate.deliveryDate,
            measuredPackages:  measurement.totalPackages,
            remitoPackages:    remito.packages ?? 0,
        },
    });
}

/**
 * Persists a failed / degraded match as a DeliveryError.
 * Fills in as many source IDs and package counts as are available.
 */
export async function saveDeliveryError(
    prisma: PrismaClient,
    candidate: MatchCandidate,
    errors: string[],
): Promise<void> {
    const { measurement, measurementError, remito, remitoError } = candidate;

    const clientName =
        remito?.clientName ??
        remitoError?.clientName ??
        null;

    const measuredPackages =
        measurement?.totalPackages ??
        (measurementError?.packages
            ? measurementError.packages.reduce((s, p) => s + p.quantity, 0)
            : null);

    const remitoPackages =
        remito?.packages ?? remitoError?.packages ?? null;

    console.log(
        `[Matching Storage] Saving DeliveryError — ` +
        `clientId: ${candidate.clientId}, date: ${candidate.deliveryDate.toISOString().slice(0, 10)}, ` +
        `errors: [${errors.join(', ')}]`,
    );

    await prisma.deliveryError.create({
        data: {
            deliveryDate:          candidate.deliveryDate,
            clientId:              candidate.clientId,
            clientName,
            measurementDataId:     measurement?.id       ?? null,
            measurementDataErrorId: measurementError?.id ?? null,
            remitoId:              remito?.id            ?? null,
            remitoErrorId:         remitoError?.id       ?? null,
            measuredPackages:      measuredPackages      ?? null,
            remitoPackages:        remitoPackages        ?? null,
            errors:                errors,
        },
    });
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function candidateKey(clientId: number, date: Date): string {
    return `${clientId}|${dateKey(date)}`;
}

function parseJsonPackages(raw: unknown): Array<{ quantity: number }> | null {
    if (!raw) return null;
    try {
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(arr)) return null;
        return arr.filter(
            (p): p is { quantity: number } =>
                typeof p === 'object' && p !== null && typeof p.quantity === 'number',
        );
    } catch {
        return null;
    }
}

function parseJsonErrors(raw: unknown): string[] {
    if (!raw) return [];
    try {
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(arr)) return [];
        return arr.filter((e): e is string => typeof e === 'string');
    } catch {
        return [];
    }
}

// Fix typo in local type alias used inside groupIntoCandidates
type RomitoRow = RemitoRow;