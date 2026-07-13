import { prisma } from '../../shared/db/prisma';
import { Cache } from '../../shared/utils';
import { GraphApi } from '../whatsapp/graph-api';
import { Message } from '../whatsapp/message';
import { parseDeliveryMessage, hasErrors } from './services/parser';
import { findActiveTariffPeriod, saveDelivery, saveDeliveryError } from './services/storage';
import { formatDeliveryReply } from './services/formatter';
import { findClient } from '../../shared/db/client';
import { Package, PendingBultosConfirmation } from './types';

// ─── Cache key ────────────────────────────────────────────────────────────────

function pendingCacheKey(outgoingMessageId: string): string {
    return `bultos:pending:${outgoingMessageId}`;
}

// ─── Reply IDs ────────────────────────────────────────────────────────────────

const REPLY_ID = {
    DATA_OK: 'bultos_data_ok',
    DATA_WRONG: 'bultos_data_wrong',
} as const;

// ─── Step 1 — Text message handler ───────────────────────────────────────────

export async function handleMeasurementMessage(
    phoneNumberId: string,
    message: Message,
): Promise<void> {
    console.log(
        `[Bultos Controller] Handling measurement message from: ${message.senderPhoneNumber}, ` +
        `messageId: ${message.id}`,
    );

    try {
        const { date, deliveries } = await parseDeliveryMessage(prisma, message.text as string);

        if (deliveries.length === 0) {
            console.log(
                `[Bultos Controller] Message contains no deliveries, ignoring: ${message.senderPhoneNumber}`,
            );
            return;
        }

        const period = await findActiveTariffPeriod(prisma, date);

        // Resolve client IDs up-front so we have them ready when saving after confirmation
        const resolvedDeliveries = await Promise.all(
            deliveries.map(async (delivery) => {
                if (hasErrors(delivery)) {
                    return { ...delivery, clientId: undefined, periodId: period?.id };
                }
                const client = await findClient(prisma, delivery.client);
                return {
                    ...delivery,
                    clientId: client?.id,
                    periodId: period?.id,
                };
            }),
        );

        // Ask the driver to review the parsed data before saving anything
        const reviewText = buildDataReviewMessage(date, resolvedDeliveries);

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
            // Fallback: save immediately if we can't cache the pending state
            console.warn(
                '[Bultos Controller] Could not retrieve outgoing message ID; saving without confirmation.',
            );
            await saveDeliveries(resolvedDeliveries, message.text as string, date);
            await GraphApi.sendTextMessage(
                message.id,
                phoneNumberId,
                message.senderPhoneNumber,
                `Medidas guardadas\n${formatDeliveryReply(deliveries)}`,
            );
            return;
        }

        const pending: PendingBultosConfirmation = {
            phoneNumberId,
            driverPhoneNumber: message.senderPhoneNumber,
            rawMessage: message.text as string,
            date,
            deliveries: resolvedDeliveries,
        };

        await Cache.set(pendingCacheKey(outgoingMessageId), JSON.stringify(pending));
        console.log(
            `[Bultos Controller] Data review sent; pending state cached under key: ${pendingCacheKey(outgoingMessageId)}`,
        );

    } catch (error) {
        console.error(
            `[Bultos Controller] Error handling measurement message from: ${message.senderPhoneNumber}:`,
            error,
        );
        throw error;
    }
}

// ─── Step 2 — Interactive reply handler ──────────────────────────────────────

/**
 * Handles the ✅ Correcto / ❌ Incorrecto reply from the driver.
 * Returns true if this reply belonged to a bultos confirmation flow.
 */
export async function handleBultosInteractiveReply(
    phoneNumberId: string,
    message: Message,
): Promise<boolean> {
    const contextMessageId = message.contextMessageId;
    if (!contextMessageId) return false;

    const cacheKey = pendingCacheKey(contextMessageId);
    const cached = await Cache.get(cacheKey);
    if (!cached) return false;

    let pending: PendingBultosConfirmation;
    try {
        pending = JSON.parse(cached) as PendingBultosConfirmation;
        pending.date = new Date(pending.date);
    } catch {
        console.error('[Bultos Controller] Failed to parse cached pending state');
        return false;
    }

    await Cache.remove(cacheKey);

    const replyId = message.interactiveReplyId;
    console.log(`[Bultos Controller] Interactive reply received — replyId: "${replyId}"`);

    if (replyId === REPLY_ID.DATA_WRONG) {
        // Driver says the data is wrong — discard without saving
        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            pending.driverPhoneNumber,
            '❌ *Medidas descartadas*\n\nReenviá el mensaje para volver a intentarlo.',
        );
        console.log('[Bultos Controller] Delivery discarded after driver rejected parsed data.');
        return true;
    }

    if (replyId === REPLY_ID.DATA_OK) {
        // Driver confirmed — save all deliveries
        await saveDeliveries(pending.deliveries, pending.rawMessage, pending.date);

        console.log(
            `[Bultos Controller] Measurement message saved after driver confirmation for: ${pending.driverPhoneNumber}`,
        );

        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            pending.driverPhoneNumber,
            `Medidas guardadas\n${formatDeliveryReply(pending.deliveries)}`,
        );
        return true;
    }

    console.warn(`[Bultos Controller] Unexpected replyId "${replyId}" for bultos confirmation`);
    return true; // we own this context, consume it
}

// ─── Private helpers ──────────────────────────────────────────────────────────

type ResolvedDelivery = {
    client: string;
    packages: Package[];
    errors: string[];
    clientId?: number;
    periodId?: number;
};

/**
 * Persists all deliveries in a resolved delivery list.
 * Deliveries with errors go to saveDeliveryError; clean ones go to saveDelivery.
 */
async function saveDeliveries(
    deliveries: ResolvedDelivery[],
    rawMessage: string,
    date: Date,
): Promise<void> {
    for (const delivery of deliveries) {
        if (hasErrors(delivery) || !delivery.clientId) {
            await saveDeliveryError(prisma, {
                rawMessage,
                date,
                clientName: delivery.client,
                packages: delivery.packages,
                errors: delivery.clientId
                    ? delivery.errors
                    : [...delivery.errors, 'Cliente no pudo ser resuelto al momento de guardar.'],
            });
        } else {
            await saveDelivery(prisma, {
                clientId: delivery.clientId,
                date,
                periodId: delivery.periodId,
                packages: delivery.packages,
            });
        }
    }
}

/**
 * Formats the review message shown to the driver.
 * Lists every parsed delivery with client name, packages, and any errors.
 * Keeps the format concise since WhatsApp has no markdown tables.
 */
function buildDataReviewMessage(
    date: Date,
    deliveries: ResolvedDelivery[],
): string {
    const dateStr = date.toLocaleDateString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
    });

    const lines: string[] = [
        `📋 *Revisá las medidas — ${dateStr}*`,
        '',
    ];

    for (const delivery of deliveries) {
        lines.push(`*${delivery.client}*`);

        for (const pkg of delivery.packages) {
            const dims = `${pkg.length}x${pkg.width}x${pkg.height}`;
            const qty = pkg.quantity > 1 ? `${pkg.quantity}x ` : '';
            lines.push(`   ${qty}${dims}`);
        }

        if (delivery.errors.length > 0) {
            for (const e of delivery.errors) {
                lines.push(`   ⚠️ ${e}`);
            }
        }

        lines.push('');
    }

    lines.push('¿Los datos son correctos?');
    return lines.join('\n');
}