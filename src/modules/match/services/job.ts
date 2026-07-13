import { PrismaClient } from '@prisma/client';
import { MatchRunResult, MatchOutcome } from '../types';
import {
    getLastRunAt,
    setLastRunAt,
    fetchUnmatchedMeasurements,
    fetchUnmatchedMeasurementErrors,
    fetchUnmatchedRemitos,
    fetchUnmatchedRemitoErrors,
    groupIntoCandidates,
    saveDeliveryMatch,
    saveDeliveryError,
} from './storage';
import { evaluateCandidates } from './matcher';

// ─── Client name → ID resolver ────────────────────────────────────────────────

/**
 * Builds a lookup map from normalised client name / alias → clientId,
 * used to resolve RemitoError rows (which have no clientId FK).
 */
async function buildClientResolver(
    prisma: PrismaClient,
): Promise<(name: string) => number | undefined> {
    const clients = await prisma.client.findMany({
        select: {
            id:      true,
            name:    true,
            aliases: { select: { alias: true } },
        },
    });

    const map = new Map<string, number>();
    for (const c of clients) {
        map.set(normalise(c.name), c.id);
        for (const a of c.aliases) {
            map.set(normalise(a.alias), c.id);
        }
    }

    return (name: string) => map.get(normalise(name));
}

type TariffRateRow = {
    periodId: number;
    zone: string;
    volumeMinM3: number;
    volumeMaxM3: number | null;
    perM3: boolean;
    price: number;
};

function buildTariffResolver(rates: TariffRateRow[]): (input: { periodId: number | null | undefined; zone: string | null | undefined; volumeM3: number | null | undefined }) => number | null | undefined {
    const byPeriodAndZone = new Map<string, TariffRateRow[]>();

    for (const rate of rates) {
        const key = `${rate.periodId}|${rate.zone}`;
        const current = byPeriodAndZone.get(key) ?? [];
        current.push(rate);
        byPeriodAndZone.set(key, current);
    }

    for (const entries of byPeriodAndZone.values()) {
        entries.sort((a, b) => a.volumeMinM3 - b.volumeMinM3);
    }

    return ({ periodId, zone, volumeM3 }) => {
        if (periodId === null || periodId === undefined || zone === null || zone === undefined || volumeM3 === null || volumeM3 === undefined) {
            return undefined;
        }

        const entries = byPeriodAndZone.get(`${periodId}|${zone}`);
        if (!entries || entries.length === 0) {
            return undefined;
        }

        const match = entries.find(rate =>
            volumeM3 >= rate.volumeMinM3 &&
            (rate.volumeMaxM3 === null || volumeM3 <= rate.volumeMaxM3),
        );

        if (!match) {
            return undefined;
        }

        return match.perM3 ? match.price * volumeM3 : match.price;
    };
}

function normalise(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

// ─── Main job ─────────────────────────────────────────────────────────────────

/**
 * Runs the full delivery-matching job:
 *
 * 1. Fetches all unmatched records from both sides (re-match strategy).
 * 2. Groups them into (clientId, calendar-day) candidates.
 * 3. Evaluates each candidate (pure logic, no DB calls).
 * 4. Persists each outcome as DeliveryMatch or DeliveryError.
 * 5. Updates the MatchRunLog timestamp.
 * 6. Returns a MatchRunResult for the caller to format and send.
 *
 * The function is idempotent for already-matched records because Prisma's
 * unique constraints on DeliveryMatch will prevent double-saves — but in
 * practice the fetch queries already exclude matched records.
 */
export async function runMatchJob(prisma: PrismaClient): Promise<MatchRunResult> {
    const ranAt = new Date();
    console.log(`[Matching Job] Starting match run at ${ranAt.toISOString()}`);

    const lastRunAt = await getLastRunAt(prisma);
    console.log(
        `[Matching Job] Last run: ${lastRunAt?.toISOString() ?? 'never'}`,
    );

    // ── 1. Fetch all unmatched records ────────────────────────────────────────

    const [measurements, measurementErrors, remitos, remitoErrors] = await Promise.all([
        fetchUnmatchedMeasurements(prisma),
        fetchUnmatchedMeasurementErrors(prisma),
        fetchUnmatchedRemitos(prisma),
        fetchUnmatchedRemitoErrors(prisma),
    ]);

    console.log(
        `[Matching Job] Fetched — measurements: ${measurements.length}, ` +
        `measurementErrors: ${measurementErrors.length}, ` +
        `remitos: ${remitos.length}, remitoErrors: ${remitoErrors.length}`,
    );

    // ── 2. Build client resolver and group into candidates ────────────────────

    const resolveClientId = await buildClientResolver(prisma);
    const periodIds = Array.from(new Set(
        measurements
            .map(m => m.periodId)
            .filter((periodId): periodId is number => periodId !== null && periodId !== undefined),
    ));

    const tariffRates = periodIds.length > 0
        ? await prisma.tariffRate.findMany({
            where: { periodId: { in: periodIds } },
            select: {
                periodId: true,
                zone: true,
                volumeMinM3: true,
                volumeMaxM3: true,
                perM3: true,
                price: true,
            },
        })
        : [];

    const resolveTariff = buildTariffResolver(tariffRates);

    const { candidates, skippedCount } = groupIntoCandidates(
        measurements,
        measurementErrors,
        remitos,
        remitoErrors,
        resolveClientId,
        resolveTariff,
    );

    console.log(
        `[Matching Job] Grouped into ${candidates.length} candidates, ` +
        `${skippedCount} skipped (no pair yet)`,
    );

    // ── 3. Evaluate candidates ────────────────────────────────────────────────

    const outcomes = evaluateCandidates(candidates);

    // ── 4. Persist outcomes ───────────────────────────────────────────────────

    let successCount = 0;
    let errorCount   = 0;

    for (const outcome of outcomes) {
        try {
            if (outcome.kind === 'success') {
                await saveDeliveryMatch(prisma, outcome.candidate);
                successCount++;
            } else {
                await saveDeliveryError(prisma, outcome.candidate, outcome.errors);
                errorCount++;
            }
        } catch (err) {
            // Log and continue — a single failed persist should not abort the run
            console.error(
                `[Matching Job] Failed to persist outcome for ` +
                `clientId=${outcome.candidate.clientId} ` +
                `date=${outcome.candidate.deliveryDate.toISOString().slice(0, 10)}:`,
                err,
            );
        }
    }

    // ── 5. Update run log ─────────────────────────────────────────────────────

    await setLastRunAt(prisma, ranAt);

    console.log(
        `[Matching Job] Run complete — ` +
        `success: ${successCount}, errors: ${errorCount}, skipped: ${skippedCount}`,
    );

    return {
        ranAt,
        successCount,
        errorCount,
        skippedCount,
        outcomes,
    };
}