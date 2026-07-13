import { PrismaClient } from '@prisma/client';
import { TariffUpload } from './parser';
import { AddressZone } from '../../admin/types';

// ─── Zone enum mapping ────────────────────────────────────────────────────────

// Prisma Zone enum values — must match schema.prisma exactly.
const ZONE_ENUM: Record<AddressZone, 'CABA' | 'AMBA_1' | 'AMBA_2' | 'AMBA_3'> = {
    CABA:   'CABA',
    AMBA_1: 'AMBA_1',
    AMBA_2: 'AMBA_2',
    AMBA_3: 'AMBA_3',
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SaveTariffResult {
    periodId: number;
    label: string;
    ratesCreated: number;
    wasUpdate: boolean; // true if a period with this label already existed
}

/**
 * Persists a validated TariffUpload.
 *
 * Strategy:
 *  - If a TariffPeriod with the same label already exists, delete its existing
 *    rates and replace them (re-upload / correction scenario).
 *  - Otherwise create a fresh period row.
 *  - All rate rows are created in a single transaction.
 */
export async function saveTariffPeriod(
    prisma: PrismaClient,
    upload: TariffUpload,
): Promise<SaveTariffResult> {
    console.log(
        `[Tariff Storage] Saving period "${upload.label}" ` +
        `(validFrom: ${upload.validFrom.toISOString().slice(0, 10)}, ` +
        `${upload.brackets.length} brackets, hourly: ${upload.hourlyRateCaba ?? 'none'})`,
    );

    const existing = await prisma.tariffPeriod.findUnique({
        where: { label: upload.label },
        select: { id: true },
    });

    let periodId: number;
    let wasUpdate = false;

    if (existing) {
        periodId = existing.id;
        wasUpdate = true;

        // Wipe existing rates so we get a clean replacement
        await prisma.$transaction([
            prisma.tariffRate.deleteMany({ where: { periodId } }),
            prisma.tariffHourlyRate.deleteMany({ where: { periodId } }),
            prisma.tariffPeriod.update({
                where: { id: periodId },
                data:  { validFrom: upload.validFrom },
            }),
        ]);

        console.log(
            `[Tariff Storage] Existing period id=${periodId} found — rates replaced.`,
        );
    } else {
        const period = await prisma.tariffPeriod.create({
            data: {
                label:     upload.label,
                validFrom: upload.validFrom,
            },
        });
        periodId = period.id;
        console.log(`[Tariff Storage] New period created with id=${periodId}.`);
    }

    // ── Build rate rows ───────────────────────────────────────────────────────

    type RateRow = {
        periodId: number;
        volumeMinM3: number;
        volumeMaxM3: number | null;
        perM3: boolean;
        zone: 'CABA' | 'AMBA_1' | 'AMBA_2' | 'AMBA_3';
        price: number;
    };
    const rateRows: RateRow[] = [];

    for (const bracket of upload.brackets) {
        for (const zone of Object.keys(bracket.prices) as AddressZone[]) {
            rateRows.push({
                periodId,
                volumeMinM3: bracket.volumeMinM3,
                volumeMaxM3: bracket.volumeMaxM3 ?? null,
                perM3:       bracket.perM3,
                zone:        ZONE_ENUM[zone],
                price:       bracket.prices[zone],
            });
        }
    }

    await prisma.tariffRate.createMany({ data: rateRows });

    // ── Optional hourly rate (CABA only) ──────────────────────────────────────

    if (upload.hourlyRateCaba !== null) {
        await prisma.tariffHourlyRate.create({
            data: {
                periodId,
                zone:  'CABA',
                price: upload.hourlyRateCaba,
            },
        });
    }

    console.log(
        `[Tariff Storage] Period id=${periodId} saved — ` +
        `${rateRows.length} rate rows, hourly: ${upload.hourlyRateCaba ?? 'none'}.`,
    );

    return {
        periodId,
        label: upload.label,
        ratesCreated: rateRows.length,
        wasUpdate,
    };
}