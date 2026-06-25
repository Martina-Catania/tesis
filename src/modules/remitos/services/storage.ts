import { PrismaClient } from '@prisma/client';
import { RemitoInput, RemitoErrorInput } from '../types';

// ─── Save remito ─────────────────────────────────────────────────────────────

/**
 * Persists a successfully parsed remito.
 * clientId is left null until an automated job or human review confirms the match.
 */
export async function saveRemito(prisma: PrismaClient, input: RemitoInput) {
    console.log(
        `[Remitos Storage] Saving remito — client: "${input.clientName ?? 'unknown'}", ` +
        `address: "${input.address ?? 'unknown'}", packages: ${input.packages ?? 'unknown'}, ` +
        `date: ${input.date.toISOString()}`,
    );

    try {
        const remito = await prisma.remito.create({
            data: {
                date:       input.date,
                rawText:    input.rawText,
                clientName: input.clientName ?? null,
                address:    input.address    ?? null,
                packages:   input.packages   ?? null,
                clientId:   input.clientId   ?? null,
                confirmed:  false,
            },
        });
        console.log(`[Remitos Storage] Remito saved successfully: id ${remito.id}`);
        return remito;
    } catch (error) {
        console.error(`[Remitos Storage] Error saving remito:`, error);
        throw error;
    }
}

// ─── Save remito error ────────────────────────────────────────────────────────

/**
 * Persists a remito image whose data could not be fully extracted.
 * Stores whatever context was available at the time of the error.
 */
export async function saveRemitoError(prisma: PrismaClient, input: RemitoErrorInput) {
    console.log(
        `[Remitos Storage] Saving remito error — client: "${input.clientName ?? 'unknown'}", ` +
        `errors: [${input.errors.join(', ')}]`,
    );

    try {
        const remitoError = await prisma.remitoError.create({
            data: {
                date:       input.date,
                rawText:    input.rawText    ?? null,
                clientName: input.clientName ?? null,
                address:    input.address    ?? null,
                packages:   input.packages   ?? null,
                errors:     input.errors,
            },
        });
        console.log(`[Remitos Storage] Remito error saved successfully: id ${remitoError.id}`);
        return remitoError;
    } catch (error) {
        console.error(`[Remitos Storage] Error saving remito error:`, error);
        throw error;
    }
}