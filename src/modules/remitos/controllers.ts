import { prisma } from '../../shared/db/prisma';
import { Cache } from '../../shared/utils';
import { GraphApi } from '../whatsapp/graph-api';
import { Message } from '../whatsapp/message';
import { extractDataFromImage, GeminiUnavailableError } from './services/gemini';
import { parseRemitoText, hasErrors } from './services/parser';
import { saveRemito, saveRemitoError, findMatchingAddress, } from './services/storage';
import { createAddress } from '../../shared/db/client';
import { formatRemitoReply } from './services/formatter';
import { findClient } from '../../shared/db/client';
import { PendingAddressConfirmation, AddressZone } from './types';

// ─── Cache key helpers ────────────────────────────────────────────────────────

function pendingCacheKey(outgoingMessageId: string): string {
    return `remito:pending:${outgoingMessageId}`;
}

// ─── Interactive reply button / list IDs ─────────────────────────────────────

const REPLY_ID = {
    // Data confirmation (new — shown first for every remito)
    DATA_OK: 'remito_data_ok',
    DATA_WRONG: 'remito_data_wrong',

    // Address confirmation (shown when address is unknown)
    ADDRESS_VALID: 'remito_addr_valid',
    ADDRESS_INVALID: 'remito_addr_invalid',

    // Zone selection
    ZONE_CABA: 'remito_zone_caba',
    ZONE_AMBA_1: 'remito_zone_amba1',
    ZONE_AMBA_2: 'remito_zone_amba2',
    ZONE_AMBA_3: 'remito_zone_amba3',
} as const;

const ZONE_FROM_REPLY_ID: Record<string, AddressZone> = {
    [REPLY_ID.ZONE_CABA]: 'CABA',
    [REPLY_ID.ZONE_AMBA_1]: 'AMBA_1',
    [REPLY_ID.ZONE_AMBA_2]: 'AMBA_2',
    [REPLY_ID.ZONE_AMBA_3]: 'AMBA_3',
};

// ─── Step 1 — Initial image handler ──────────────────────────────────────────

export async function handleRemitoMessage(
    phoneNumberId: string,
    message: Message,
): Promise<void> {
    console.log(
        `[Remitos Controller] Handling remito image from: ${message.senderPhoneNumber}, ` +
        `messageId: ${message.id}`,
    );

    const date = new Date();
    date.setMilliseconds(0);

    try {
        // 1. Resolve and download the image from WhatsApp
        const mediaUrl = await GraphApi.getMediaUrl(message.imageId as string);
        const imageBuffer = await GraphApi.downloadMedia(mediaUrl);

        // 2. Send the image to Gemini Vision (retries internally on 429/503)
        let rawText: string;
        try {
            rawText = await extractDataFromImage(imageBuffer);
        } catch (error) {
            if (error instanceof GeminiUnavailableError) {
                console.error(
                    `[Remitos Controller] Gemini unavailable after ${error.attempts} attempts:`,
                    error.cause,
                );
                await saveRemitoError(prisma, {
                    date,
                    errors: ['El servicio de lectura de imágenes no está disponible en este momento. Por favor, reintentá en unos minutos.'],
                });
                await GraphApi.sendTextMessage(
                    message.id,
                    phoneNumberId,
                    message.senderPhoneNumber,
                    '⚠️ No pudimos procesar la imagen en este momento porque el servicio está con alta demanda. Por favor, reenviá el remito en unos minutos.',
                );
                return;
            }
            throw error;
        }
        console.log(`[Remitos Controller] Gemini raw response: "${rawText}"`);

        // 3. Parse Gemini's response into structured data
        const parsed = parseRemitoText(rawText);

        // 4. Validate the extracted client against the DB
        let resolvedClientId: number | undefined;

        if (parsed.data.clientName) {
            const client = await findClient(prisma, parsed.data.clientName);
            if (client) {
                resolvedClientId = client.id;
            } else {
                parsed.errors.push(`Cliente desconocido: "${parsed.data.clientName}"`);
            }
        }

        // 5. Ask the driver to confirm the extracted data before saving anything.
        //    We do this regardless of whether there are parse errors — the driver
        //    may spot that the image was wrong and prefer to discard it entirely.
        const reviewText = buildDataReviewMessage(parsed.data.clientName, parsed.data.address, parsed.data.packages, parsed.errors);

        const outgoingMessage = await GraphApi.messageWithInteractiveReply(
            message.id,
            phoneNumberId,
            message.senderPhoneNumber,
            reviewText,
            [
                { id: REPLY_ID.DATA_OK, title: '✅ Correcto' },
                { id: REPLY_ID.DATA_WRONG, title: '❌ Incorrecto' },
            ],
        ) as { messages?: Array<{ id: string }> };

        const outgoingMessageId = outgoingMessage?.messages?.[0]?.id;

        if (!outgoingMessageId) {
            // Can't cache without the message ID — fall back to saving immediately
            console.warn(
                '[Remitos Controller] Could not retrieve outgoing message ID for data review; ' +
                'saving without driver confirmation.',
            );
            await saveWithoutConfirmation(date, rawText, parsed, resolvedClientId, phoneNumberId, message);
            return;
        }

        const pending: PendingAddressConfirmation = {
            step: 'confirm_data',
            phoneNumberId,
            driverPhoneNumber: message.senderPhoneNumber,
            date,
            rawText,
            clientName: parsed.data.clientName,
            address: parsed.data.address,
            packages: parsed.data.packages,
            clientId: resolvedClientId,
            errors: parsed.errors,
        };

        await Cache.set(pendingCacheKey(outgoingMessageId), JSON.stringify(pending));
        console.log(
            `[Remitos Controller] Data review sent; pending state cached under key: ${pendingCacheKey(outgoingMessageId)}`,
        );

    } catch (error) {
        console.error(
            `[Remitos Controller] Error handling remito from: ${message.senderPhoneNumber}:`,
            error,
        );
        throw error;
    }
}

// ─── Step 2, 3 & 4 — Interactive reply handler ────────────────────────────────

export async function handleRemitoInteractiveReply(
    phoneNumberId: string,
    message: Message,
): Promise<boolean> {
    const contextMessageId = message.contextMessageId;
    if (!contextMessageId) return false;

    const cacheKey = pendingCacheKey(contextMessageId);
    const cached = await Cache.get(cacheKey);
    if (!cached) return false;

    let pending: PendingAddressConfirmation;
    try {
        pending = JSON.parse(cached) as PendingAddressConfirmation;
        pending.date = new Date(pending.date);
    } catch {
        console.error('[Remitos Controller] Failed to parse cached pending state');
        return false;
    }

    const replyId = message.interactiveReplyId;
    console.log(
        `[Remitos Controller] Interactive reply received — step: ${pending.step}, replyId: "${replyId}"`,
    );

    // ── confirm_data step (new first step) ────────────────────────────────────

    if (pending.step === 'confirm_data') {
        if (replyId === REPLY_ID.DATA_WRONG) {
            await Cache.remove(cacheKey);

            // Driver says the extracted data is wrong — save as error and stop
            await saveRemitoError(prisma, {
                date: pending.date,
                rawText: pending.rawText,
                clientName: pending.clientName,
                address: pending.address,
                packages: pending.packages,
                errors: [...pending.errors, 'El chofer indicó que los datos extraídos son incorrectos.'],
            });

            await GraphApi.sendTextMessage(
                message.id,
                phoneNumberId,
                pending.driverPhoneNumber,
                '❌ *Remito descartado*\n\nReenviá la foto del remito para volver a intentarlo.',
            );

            console.log('[Remitos Controller] Remito discarded after driver rejected extracted data.');
            return true;
        }

        if (replyId === REPLY_ID.DATA_OK) {
            await Cache.remove(cacheKey);

            // Driver confirmed the data is correct — now continue with the
            // existing address-check logic, exactly as before.
            await continueAfterDataConfirmation(phoneNumberId, message, pending);
            return true;
        }

        console.warn(`[Remitos Controller] Unexpected replyId "${replyId}" for step confirm_data`);
        return true; // we own this context, consume it
    }

    // ── confirm_address step ──────────────────────────────────────────────────

    if (pending.step === 'confirm_address') {
        if (replyId === REPLY_ID.ADDRESS_INVALID) {
            await Cache.remove(cacheKey);

            await saveRemitoError(prisma, {
                date: pending.date,
                rawText: pending.rawText,
                clientName: pending.clientName,
                address: pending.address,
                packages: pending.packages,
                errors: [
                    ...pending.errors,
                    `Dirección inválida confirmada: "${pending.address}"`,
                ],
            });

            await GraphApi.sendTextMessage(
                message.id,
                phoneNumberId,
                pending.driverPhoneNumber,
                '❌ *Remito guardado con error*\n\nLa dirección fue marcada como inválida.',
            );

            console.log('[Remitos Controller] Remito saved as error after driver rejected address.');
            return true;
        }

        if (replyId === REPLY_ID.ADDRESS_VALID) {
            const updatedPending: PendingAddressConfirmation = { ...pending, step: 'select_zone' };

            const outgoingMessage = await GraphApi.messageWithInteractiveList(
                message.id,
                phoneNumberId,
                pending.driverPhoneNumber,
                `✅ Perfecto. ¿A qué zona pertenece *${pending.address}*?`,
                'Seleccionar zona',
                [
                    {
                        title: 'Zona',
                        rows: [
                            { id: REPLY_ID.ZONE_CABA, title: 'CABA', description: 'Ciudad Autónoma de Buenos Aires' },
                            { id: REPLY_ID.ZONE_AMBA_1, title: 'AMBA 1', description: 'Avellaneda, Lanus, Lomas de Zamora, La Matanza, Morón Hurlingham, Ituzaingó, Tres de Febrero, San Martín, Vicente Lopez, San Isidro' },
                            { id: REPLY_ID.ZONE_AMBA_2, title: 'AMBA 2', description: 'Quilmes, Berazategui, Florencio Varela, Almirante Brown, Esteban Echevarría, Ezeiza, Merlo, Moreno, San Miguel, José C Paz, Malvinas Argentinas, San Fernando, Tigre' },
                            { id: REPLY_ID.ZONE_AMBA_3, title: 'AMBA 3', description: 'La Plata, Ensenada, Berazategui, Presidente Peron, San Vicente, Cañuelas, Marcos Paz, General Rodriguez, Lujan, Pilar, Escobar, Campana, Exaltación de la Cruz, Zarate' },
                        ],
                    },
                ],
            ) as { messages?: Array<{ id: string }> };

            await Cache.remove(cacheKey);

            const newOutgoingMessageId = outgoingMessage?.messages?.[0]?.id;
            if (newOutgoingMessageId) {
                await Cache.set(
                    pendingCacheKey(newOutgoingMessageId),
                    JSON.stringify(updatedPending),
                );
                console.log(
                    `[Remitos Controller] Zone selection sent; pending state moved to key: ${pendingCacheKey(newOutgoingMessageId)}`,
                );
            } else {
                console.warn(
                    '[Remitos Controller] Could not retrieve outgoing message ID for zone question; saving as error.',
                );
                await saveRemitoError(prisma, {
                    date: pending.date,
                    rawText: pending.rawText,
                    clientName: pending.clientName,
                    address: pending.address,
                    packages: pending.packages,
                    errors: [...pending.errors, 'No se pudo completar la selección de zona.'],
                });
            }
            return true;
        }

        console.warn(`[Remitos Controller] Unexpected replyId "${replyId}" for step confirm_address`);
        return true;
    }

    // ── select_zone step ──────────────────────────────────────────────────────

    if (pending.step === 'select_zone') {
        const zone = replyId ? ZONE_FROM_REPLY_ID[replyId] : undefined;

        if (!zone) {
            console.warn(`[Remitos Controller] Unexpected replyId "${replyId}" for step select_zone`);
            return true;
        }

        await Cache.remove(cacheKey);

        const newAddress = await createAddress(
            prisma,
            pending.clientId!,
            pending.address!,
            zone,
        );

        const saved = await saveRemito(prisma, {
            date: pending.date,
            rawText: pending.rawText,
            clientName: pending.clientName,
            address: pending.address,
            packages: pending.packages,
            clientId: pending.clientId,
            addressId: newAddress.id,
        });

        console.log(
            `[Remitos Controller] New address id=${newAddress.id} created and remito id=${saved.id} saved.`,
        );

        const parsedForReply = {
            data: {
                clientName: pending.clientName,
                address: pending.address,
                packages: pending.packages,
            },
            errors: pending.errors,
        };

        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            pending.driverPhoneNumber,
            formatRemitoReply(parsedForReply) +
            `\n\n_Dirección nueva guardada en zona ${zone.replace('_', ' ')}._`,
        );

        return true;
    }

    return false;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Builds the data-review message shown to the driver after Gemini extraction.
 * Displays whatever was extracted (including any parse errors) and asks for
 * a binary confirm/reject.
 */
function buildDataReviewMessage(
    clientName?: string,
    address?: string,
    packages?: number,
    errors: string[] = [],
): string {
    const lines: string[] = ['📋 *Revisá los datos del remito:*', ''];

    lines.push(`*Cliente:* ${clientName ?? '—'}`);
    lines.push(`*Dirección:* ${address ?? '—'}`);
    lines.push(`*Bultos:* ${packages !== undefined ? packages : '—'}`);

    if (errors.length > 0) {
        lines.push('');
        lines.push('⚠️ _Campos con problemas:_');
        for (const e of errors) {
            lines.push(`   - ${e}`);
        }
    }

    lines.push('');
    lines.push('¿Los datos son correctos?');

    return lines.join('\n');
}

/**
 * Continues the flow after the driver confirmed the extracted data is correct.
 * This is the logic that was previously the bottom half of handleRemitoMessage:
 * check the address, save, or ask about unknown addresses.
 */
async function continueAfterDataConfirmation(
    phoneNumberId: string,
    message: Message,
    pending: PendingAddressConfirmation,
): Promise<void> {
    const parsed = {
        data: {
            clientName: pending.clientName,
            address: pending.address,
            packages: pending.packages,
        },
        errors: pending.errors,
    };

    // If client is resolved and address is present, check address against DB
    if (pending.clientId !== undefined && pending.address) {
        const addressMatch = await findMatchingAddress(
            prisma,
            pending.clientId,
            pending.address,
        );

        if (addressMatch.matched) {
            // Known address — save and reply
            await saveRemito(prisma, {
                date: pending.date,
                rawText: pending.rawText,
                clientName: pending.clientName,
                address: pending.address,
                packages: pending.packages,
                clientId: pending.clientId,
                addressId: addressMatch.addressId,
            });

            console.log('[Remitos Controller] Remito saved after driver confirmed data.');

            await GraphApi.sendTextMessage(
                message.id,
                phoneNumberId,
                pending.driverPhoneNumber,
                formatRemitoReply(parsed),
            );
            return;
        }

        // Unknown address — ask the driver
        console.log(
            `[Remitos Controller] Unknown address for clientId ${pending.clientId}: "${pending.address}". ` +
            `Asking driver for confirmation.`,
        );

        const outgoingMessage = await GraphApi.messageWithInteractiveReply(
            message.id,
            phoneNumberId,
            pending.driverPhoneNumber,
            `⚠️ Dirección desconocida para *${pending.clientName}*:\n\n` +
            `_"${pending.address}"_\n\n` +
            `¿Agregar dirección?`,
            [
                { id: REPLY_ID.ADDRESS_VALID, title: '✅ Sí, guardar' },
                { id: REPLY_ID.ADDRESS_INVALID, title: '❌ No, es un error' },
            ],
        ) as { messages?: Array<{ id: string }> };

        const outgoingMessageId = outgoingMessage?.messages?.[0]?.id;
        if (outgoingMessageId) {
            const nextPending: PendingAddressConfirmation = {
                ...pending,
                step: 'confirm_address',
            };
            await Cache.set(pendingCacheKey(outgoingMessageId), JSON.stringify(nextPending));
            console.log(
                `[Remitos Controller] Address confirmation sent; pending state cached under key: ${pendingCacheKey(outgoingMessageId)}`,
            );
        } else {
            console.warn(
                '[Remitos Controller] Could not retrieve outgoing message ID for address question; saving as error.',
            );
            await saveRemitoError(prisma, {
                date: pending.date,
                rawText: pending.rawText,
                clientName: pending.clientName,
                address: pending.address,
                packages: pending.packages,
                errors: [...pending.errors, `Dirección desconocida para este cliente: "${pending.address}"`],
            });
        }
        return;
    }

    // No address lookup needed — save with whatever we have
    if (hasErrors(parsed)) {
        await saveRemitoError(prisma, {
            date: pending.date,
            rawText: pending.rawText,
            clientName: pending.clientName,
            address: pending.address,
            packages: pending.packages,
            errors: pending.errors,
        });
    } else {
        await saveRemito(prisma, {
            date: pending.date,
            rawText: pending.rawText,
            clientName: pending.clientName,
            address: pending.address,
            packages: pending.packages,
            clientId: pending.clientId,
        });
    }

    console.log('[Remitos Controller] Remito saved after driver confirmed data.');

    await GraphApi.sendTextMessage(
        message.id,
        phoneNumberId,
        pending.driverPhoneNumber,
        formatRemitoReply(parsed),
    );
}

/**
 * Fallback: save immediately without driver confirmation (used when we can't
 * retrieve the outgoing message ID to cache the pending state).
 * Behaviour is identical to the original pre-confirmation flow.
 */
async function saveWithoutConfirmation(
    date: Date,
    rawText: string,
    parsed: { data: { clientName?: string; address?: string; packages?: number }; errors: string[] },
    resolvedClientId: number | undefined,
    phoneNumberId: string,
    message: Message,
): Promise<void> {
    if (resolvedClientId !== undefined && parsed.data.address) {
        const addressMatch = await findMatchingAddress(prisma, resolvedClientId, parsed.data.address);

        if (addressMatch.matched) {
            await saveRemito(prisma, {
                date, rawText,
                clientName: parsed.data.clientName,
                address: parsed.data.address,
                packages: parsed.data.packages,
                clientId: resolvedClientId,
                addressId: addressMatch.addressId,
            });
        } else {
            await saveRemitoError(prisma, {
                date, rawText,
                clientName: parsed.data.clientName,
                address: parsed.data.address,
                packages: parsed.data.packages,
                errors: [...parsed.errors, `Dirección desconocida para este cliente: "${parsed.data.address}"`],
            });
        }
    } else if (hasErrors(parsed)) {
        await saveRemitoError(prisma, {
            date, rawText,
            clientName: parsed.data.clientName,
            address: parsed.data.address,
            packages: parsed.data.packages,
            errors: parsed.errors,
        });
    } else {
        await saveRemito(prisma, {
            date, rawText,
            clientName: parsed.data.clientName,
            address: parsed.data.address,
            packages: parsed.data.packages,
            clientId: resolvedClientId,
        });
    }

    await GraphApi.sendTextMessage(
        message.id,
        phoneNumberId,
        message.senderPhoneNumber,
        formatRemitoReply(parsed),
    );
}