import { PrismaClient } from '@prisma/client';
import { RemitoInput, RemitoErrorInput } from '../types';

// ─── Address matching ─────────────────────────────────────────────────────────

// Common Argentine street abbreviations that Gemini or the remito may use.
const ABBREVIATIONS: [RegExp, string][] = [
    [/\bav\b\.?/g,    'avenida'],
    [/\bpje\b\.?/g,   'pasaje'],
    [/\bpte\b\.?/g,   'presidente'],
    [/\bprov\b\.?/g,  'provincia'],
    [/\bpso\b\.?/g,   'paseo'],
    [/\bgral\b\.?/g,  'general'],
    [/\binte\b\.?/g,  'intendente'],
    [/\bsgo\b\.?/g,   'santiago'],
    [/\bste\b\.?/g,   'sante'],
];

/**
 * Normalises an address string for fuzzy comparison:
 *   - strips accents
 *   - lowercases
 *   - expands known abbreviations
 *   - collapses whitespace / punctuation
 */
function normaliseAddress(raw: string): string {
    let s = raw
        .normalize('NFD')                       // decompose accented chars
        .replace(/[\u0300-\u036f]/g, '')        // strip diacritic marks
        .toLowerCase()
        .replace(/[.,\-/#!$%^&*;:{}=_`~()]/g, ' ');  // punctuation → space

    for (const [pattern, expansion] of ABBREVIATIONS) {
        s = s.replace(pattern, expansion);
    }

    return s.replace(/\s+/g, ' ').trim();
}

/** Levenshtein distance between two strings. */
function levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    // Single-row DP — O(m*n) time, O(n) space
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
        const curr = [i];
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                curr[j - 1] + 1,          // insert
                prev[j] + 1,              // delete
                prev[j - 1] + cost,       // substitute
            );
        }
        prev = curr;
    }
    return prev[n];
}

/**
 * Similarity score in [0, 1]: 1 = identical after normalisation, 0 = completely different.
 */
function similarity(a: string, b: string): number {
    const na = normaliseAddress(a);
    const nb = normaliseAddress(b);
    if (na === nb) return 1;
    const maxLen = Math.max(na.length, nb.length);
    if (maxLen === 0) return 1;
    return 1 - levenshtein(na, nb) / maxLen;
}

// A score above this threshold is considered a match.
// 0.80 tolerates minor OCR noise and abbreviation differences without
// accepting genuinely different addresses.
const MATCH_THRESHOLD = 0.80;

export interface AddressMatch {
    matched: true;
    addressId: number;
    address: string;
    score: number;
}

export interface AddressMiss {
    matched: false;
}

export type AddressLookupResult = AddressMatch | AddressMiss;

/**
 * Checks whether a Gemini-extracted address string matches any active address
 * belonging to a specific client. Uses normalisation + Levenshtein similarity
 * to tolerate OCR noise, abbreviation differences, and minor typos.
 *
 * Returns the best match above the threshold, or { matched: false } if none is found.
 * Should only be called when both clientId and address are available.
 */
export async function findMatchingAddress(
    prisma: PrismaClient,
    clientId: number,
    extractedAddress: string,
): Promise<AddressLookupResult> {
    console.log(
        `[Remitos Storage] Looking up address for clientId ${clientId}: "${extractedAddress}"`,
    );

    const addresses = await prisma.address.findMany({
        where:  { clientId, active: true },
        select: { id: true, address: true },
    });

    if (addresses.length === 0) {
        console.log(`[Remitos Storage] No active addresses found for clientId ${clientId}`);
        return { matched: false };
    }

    let bestScore = 0;
    let bestAddress: { id: number; address: string } | null = null;

    for (const addr of addresses) {
        const score = similarity(extractedAddress, addr.address);
        console.log(
            `[Remitos Storage] Similarity "${extractedAddress}" ↔ "${addr.address}": ${score.toFixed(3)}`,
        );
        if (score > bestScore) {
            bestScore = score;
            bestAddress = addr;
        }
    }

    if (bestScore >= MATCH_THRESHOLD && bestAddress) {
        console.log(
            `[Remitos Storage] Address matched: "${bestAddress.address}" (id: ${bestAddress.id}, score: ${bestScore.toFixed(3)})`,
        );
        return { matched: true, addressId: bestAddress.id, address: bestAddress.address, score: bestScore };
    }

    console.log(
        `[Remitos Storage] No address match above threshold (best: ${bestScore.toFixed(3)})`,
    );
    return { matched: false };
}

// ─── Save remito ─────────────────────────────────────────────────────────────

/**
 * Persists a successfully parsed remito.
 * clientId and addressId are set when the lookup in storage found matches;
 * both remain null until confirmed otherwise.
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
                addressId:  input.addressId  ?? null,
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
