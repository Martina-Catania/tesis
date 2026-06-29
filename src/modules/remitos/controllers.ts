import { prisma } from '../../shared/db/prisma';
import { Cache } from '../../shared/utils';
import { GraphApi } from '../whatsapp/graph-api';
import { Message } from '../whatsapp/message';
import { extractDataFromImage, GeminiUnavailableError } from './services/gemini';
import { parseRemitoText, hasErrors } from './services/parser';
import { saveRemito, saveRemitoError, findMatchingAddress, createAddress } from './services/storage';
import { formatRemitoReply } from './services/formatter';
import { findClient } from '../../shared/db/client';
import { PendingAddressConfirmation, AddressZone } from './types';

// ─── Cache key helpers ────────────────────────────────────────────────────────

/**
 * The Cache is keyed by the outgoing message ID of the interactive question
 * we sent to the driver. When the driver taps a button, the incoming
 * interactive message carries a `context.id` pointing back to that message.
 */
function pendingCacheKey(outgoingMessageId: string): string {
    return `remito:pending:${outgoingMessageId}`;
}

// ─── Interactive reply button / list IDs ─────────────────────────────────────

const REPLY_ID = {
    ADDRESS_VALID:   'remito_addr_valid',
    ADDRESS_INVALID: 'remito_addr_invalid',
    ZONE_CABA:       'remito_zone_caba',
    ZONE_AMBA_1:     'remito_zone_amba1',
    ZONE_AMBA_2:     'remito_zone_amba2',
    ZONE_AMBA_3:     'remito_zone_amba3',
} as const;

const ZONE_FROM_REPLY_ID: Record<string, AddressZone> = {
    [REPLY_ID.ZONE_CABA]:   'CABA',
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
            throw error; // unexpected error — let it propagate
        }
        console.log(`[Remitos Controller] Gemini raw response: "${rawText}"`);

        // 3. Parse Gemini's response into structured data
        const parsed = parseRemitoText(rawText);

        // 4. Validate the extracted client against the DB.
        let resolvedClientId: number | undefined;

        if (parsed.data.clientName && !hasErrors(parsed)) {
            const client = await findClient(prisma, parsed.data.clientName);
            if (client) {
                resolvedClientId = client.id;
            } else {
                parsed.errors.push(
                    `Cliente desconocido: "${parsed.data.clientName}"`,
                );
            }
        }

        // 5. If client resolved and address extracted, check address against DB.
        //    When the address is unknown, pause and ask the driver before saving.
        if (resolvedClientId !== undefined && parsed.data.address) {
            const addressMatch = await findMatchingAddress(
                prisma,
                resolvedClientId,
                parsed.data.address,
            );

            if (addressMatch.matched) {
                // Known address — save remito directly (happy path)
                await saveRemito(prisma, {
                    date,
                    rawText,
                    clientName: parsed.data.clientName,
                    address:    parsed.data.address,
                    packages:   parsed.data.packages,
                    clientId:   resolvedClientId,
                    addressId:  addressMatch.addressId,
                });

                console.log(
                    `[Remitos Controller] Remito handled successfully for: ${message.senderPhoneNumber}`,
                );

                await GraphApi.sendTextMessage(
                    message.id,
                    phoneNumberId,
                    message.senderPhoneNumber,
                    formatRemitoReply(parsed),
                );
                return;
            }

            // Unknown address — ask the driver whether it is a valid new address
            console.log(
                `[Remitos Controller] Unknown address for clientId ${resolvedClientId}: "${parsed.data.address}". ` +
                `Asking driver for confirmation.`,
            );

            const outgoingMessage = await GraphApi.messageWithInteractiveReply(
                message.id,
                phoneNumberId,
                message.senderPhoneNumber,
                `⚠️ Dirección desconocida para *${parsed.data.clientName}*:\n\n` +
                `_"${parsed.data.address}"_\n\n` +
                `Agregar dirección?`,
                [
                    { id: REPLY_ID.ADDRESS_VALID,   title: '✅ Sí, guardar' },
                    { id: REPLY_ID.ADDRESS_INVALID, title: '❌ No, es un error' },
                ],
            ) as { messages?: Array<{ id: string }> };

            // Persist the remito state in Cache so the next interactive message
            // can pick it up. Key = outgoing message ID (WhatsApp context.id).
            const outgoingMessageId = outgoingMessage?.messages?.[0]?.id;
            if (outgoingMessageId) {
                const pending: PendingAddressConfirmation = {
                    step: 'confirm_address',
                    phoneNumberId,
                    driverPhoneNumber: message.senderPhoneNumber,
                    date,
                    rawText,
                    clientName: parsed.data.clientName,
                    address:    parsed.data.address,
                    packages:   parsed.data.packages,
                    clientId:   resolvedClientId,
                    errors:     parsed.errors,
                };
                await Cache.set(pendingCacheKey(outgoingMessageId), JSON.stringify(pending));
                console.log(
                    `[Remitos Controller] Pending state cached under key: ${pendingCacheKey(outgoingMessageId)}`,
                );
            } else {
                // Could not get outgoing message ID — fall back to saving as error
                console.warn(
                    '[Remitos Controller] Could not retrieve outgoing message ID from API response; ' +
                    'saving as error instead of awaiting confirmation.',
                );
                await saveRemitoError(prisma, {
                    date,
                    rawText,
                    clientName: parsed.data.clientName,
                    address:    parsed.data.address,
                    packages:   parsed.data.packages,
                    errors: [...parsed.errors, `Dirección desconocida para este cliente: "${parsed.data.address}"`],
                });
            }
            return; // reply was sent above — we are now waiting for the driver
        }

        // 6. No address lookup needed (either client or address was missing/errored).
        //    Persist according to whether there are errors.
        if (hasErrors(parsed)) {
            await saveRemitoError(prisma, {
                date,
                rawText,
                clientName: parsed.data.clientName,
                address:    parsed.data.address,
                packages:   parsed.data.packages,
                errors:     parsed.errors,
            });
        } else {
            await saveRemito(prisma, {
                date,
                rawText,
                clientName: parsed.data.clientName,
                address:    parsed.data.address,
                packages:   parsed.data.packages,
                clientId:   resolvedClientId,
            });
        }

        console.log(
            `[Remitos Controller] Remito handled successfully for: ${message.senderPhoneNumber}`,
        );

        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            message.senderPhoneNumber,
            formatRemitoReply(parsed),
        );
    } catch (error) {
        console.error(
            `[Remitos Controller] Error handling remito from: ${message.senderPhoneNumber}:`,
            error,
        );
        throw error;
    }
}

// ─── Step 2 & 3 — Interactive reply handler ───────────────────────────────────

/**
 * Handles interactive button/list replies from drivers responding to
 * address-confirmation or zone-selection prompts.
 *
 * Called from client.ts when message.type === 'interactive'.
 *
 * Returns true if the message was handled as part of an address confirmation
 * flow, false if it was an unrelated interactive reply.
 */
export async function handleRemitoInteractiveReply(
    phoneNumberId: string,
    message: Message,
): Promise<boolean> {
    // The context ID links this reply back to the question we sent
    const contextMessageId = message.contextMessageId;
    if (!contextMessageId) {
        return false;
    }

    const cacheKey = pendingCacheKey(contextMessageId);
    const cached = await Cache.get(cacheKey);
    if (!cached) {
        return false; // not our pending state
    }

    let pending: PendingAddressConfirmation;
    try {
        pending = JSON.parse(cached) as PendingAddressConfirmation;
        // Dates are serialised as strings — restore them
        pending.date = new Date(pending.date);
    } catch {
        console.error('[Remitos Controller] Failed to parse cached pending state');
        return false;
    }

    const replyId = message.interactiveReplyId;
    console.log(
        `[Remitos Controller] Interactive reply received — step: ${pending.step}, replyId: "${replyId}"`,
    );

    // ── confirm_address step ──────────────────────────────────────────────────

    if (pending.step === 'confirm_address') {
        if (replyId === REPLY_ID.ADDRESS_INVALID) {
            // Driver confirmed the address is wrong — save as error and finish
            await Cache.remove(cacheKey);

            await saveRemitoError(prisma, {
                date:       pending.date,
                rawText:    pending.rawText,
                clientName: pending.clientName,
                address:    pending.address,
                packages:   pending.packages,
                errors:     [
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
            // Driver confirmed the address is new and valid — ask for zone
            // Update the cached state to the next step before sending the list
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
                            { id: REPLY_ID.ZONE_CABA,   title: 'CABA',   description: 'Ciudad Autónoma de Buenos Aires' },
                            { id: REPLY_ID.ZONE_AMBA_1, title: 'AMBA 1', description: 'Avellaneda, Lanus, Lomas de Zamora, La Matanza, Morón Hurlingham, Ituzaingó, Tres de Febrero, San Martín, Vicente Lopez, San Isidro' },
                            { id: REPLY_ID.ZONE_AMBA_2, title: 'AMBA 2', description: 'Quilmes, Berazategui, Florencio Varela, Almirante Brown, Esteban Echevarría, Ezeiza, Merlo, Moreno, San Miguel, José C Paz, Malvinas Argentinas, San Fernando, Tigre' },
                            { id: REPLY_ID.ZONE_AMBA_3, title: 'AMBA 3', description: 'La Plata, Ensenada, Berazategui, Presidente Peron, San Vicente, Cañuelas, Marcos Paz, General Rodriguez, Lujan, Pilar, Escobar, Campana, Exaltación de la Cruz, Zarate' },
                        ],
                    },
                ],
            ) as { messages?: Array<{ id: string }> };

            // Remove old cache entry and store under the new outgoing message ID
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
                    '[Remitos Controller] Could not retrieve outgoing message ID for zone question; ' +
                    'saving as error.',
                );
                await saveRemitoError(prisma, {
                    date:       pending.date,
                    rawText:    pending.rawText,
                    clientName: pending.clientName,
                    address:    pending.address,
                    packages:   pending.packages,
                    errors:     [...pending.errors, 'No se pudo completar la selección de zona.'],
                });
            }
            return true;
        }

        // Unrecognised reply ID for this step — ignore
        console.warn(`[Remitos Controller] Unexpected replyId "${replyId}" for step confirm_address`);
        return true; // we own this context, consume it
    }

    // ── select_zone step ──────────────────────────────────────────────────────

    if (pending.step === 'select_zone') {
        const zone = replyId ? ZONE_FROM_REPLY_ID[replyId] : undefined;

        if (!zone) {
            console.warn(`[Remitos Controller] Unexpected replyId "${replyId}" for step select_zone`);
            return true; // consume but ignore
        }

        await Cache.remove(cacheKey);

        // Create the new address in the DB
        const newAddress = await createAddress(
            prisma,
            pending.clientId,
            pending.address,
            zone,
        );

        // Now save the remito linked to the new address
        const remitoErrors = pending.errors; // errors unrelated to address
        const saved = await saveRemito(prisma, {
            date:       pending.date,
            rawText:    pending.rawText,
            clientName: pending.clientName,
            address:    pending.address,
            packages:   pending.packages,
            clientId:   pending.clientId,
            addressId:  newAddress.id,
        });

        console.log(
            `[Remitos Controller] New address id=${newAddress.id} created and remito id=${saved.id} saved.`,
        );

        // Build a ParsedRemito-like object just for the reply formatter
        const parsedForReply = {
            data: {
                clientName: pending.clientName,
                address:    pending.address,
                packages:   pending.packages,
            },
            errors: remitoErrors,
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