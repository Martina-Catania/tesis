import { PrismaClient } from '@prisma/client';
import { DeliveryInput, DeliveryErrorInput } from '../types';

// ─── Tariff period lookup ─────────────────────────────────────────────────────

/**
 * Returns the tariff period that was active on a given date,
 * i.e. the period with the latest validFrom that is still <= the delivery date.
 */
export async function findActiveTariffPeriod(prisma: PrismaClient, date: Date) {
    console.log(`[Bultos Storage] Looking up active tariff period for date: ${date.toISOString()}`);

    const period = await prisma.tariffPeriod.findFirst({
        where: { validFrom: { lte: date } },
        orderBy: { validFrom: 'desc' },
        select: { id: true, label: true, validFrom: true },
    });

    if (period) {
        console.log(`[Bultos Storage] Active tariff period found: "${period.label}" (id: ${period.id}, validFrom: ${period.validFrom.toISOString()})`);
    } else {
        console.log(`[Bultos Storage] No active tariff period found for date: ${date.toISOString()}`);
    }
    return period;
}

// ─── Save delivery ────────────────────────────────────────────────────────────

/**
 * Persists a parsed delivery and its packages in a single transaction.
 * Computes volume for each package before writing.
 */
export async function saveDelivery(prisma: PrismaClient, input: DeliveryInput) {
    console.log(`[Bultos Storage] Saving delivery for clientId: ${input.clientId}, date: ${input.date.toISOString()}, packages: ${input.packages.length}`);

    try {
        const delivery = await prisma.measurementData.create({
            data: {
                clientId: input.clientId,
                date: input.date,
                periodId: input.periodId ?? null,
                packages: {
                    create: input.packages.map((p) => ({
                        length: p.length,
                        width: p.width,
                        height: p.height,
                        quantity: p.quantity,
                        volume: p.length * p.width * p.height,
                    })),
                },
            },
            include: { packages: true },
        });
        console.log(`[Bultos Storage] Delivery saved successfully: id ${delivery.id}, clientId: ${input.clientId}`);
        return delivery;
    } catch (error) {
        console.error(`[Bultos Storage] Error saving delivery for clientId: ${input.clientId}:`, error);
        throw error;
    }
}

// ─── Save delivery error ──────────────────────────────────────────────────────

/**
 * Persists a delivery message that could not be fully parsed.
 * Stores whatever context was available at the time of the error.
 */
export async function saveDeliveryError(prisma: PrismaClient, input: DeliveryErrorInput) {
    console.log(`[Bultos Storage] Saving delivery error for client: "${input.clientName ?? 'unknown'}", errors: [${input.errors.join(', ')}]`);

    try {
        const deliveryError = await prisma.deliveryError.create({
            data: {
                rawMessage: input.rawMessage,
                date: input.date,
                clientName: input.clientName ?? null,
                clientId: input.clientId ?? null,
                packages: input.packages ?? null,
                errors: input.errors,
            },
        });
        console.log(`[Bultos Storage] Delivery error saved successfully: id ${deliveryError.id}`);
        return deliveryError;
    } catch (error) {
        console.error(`[Bultos Storage] Error saving delivery error for client: "${input.clientName ?? 'unknown'}":`, error);
        throw error;
    }
}