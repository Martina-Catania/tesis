import { prisma } from '../../shared/db/prisma';
import { Cache } from '../../shared/utils';
import { GraphApi } from '../whatsapp/graph-api';
import { Message } from '../whatsapp/message';
import { parseTariffCsv, TariffUpload } from './services/parser';
import { saveTariffPeriod } from './services/storage';
import {
    formatTariffReviewMessage,
    formatTariffSuccessMessage,
    formatTariffParseErrorMessage,
} from './services/formatter';

// ─── Cache key ────────────────────────────────────────────────────────────────

function pendingCacheKey(outgoingMessageId: string): string {
    return `tariff:pending:${outgoingMessageId}`;
}

// ─── Reply IDs ────────────────────────────────────────────────────────────────

const REPLY_ID = {
    CONFIRM: 'tariff_confirm',
    CANCEL:  'tariff_cancel',
} as const;

// ─── Pending state ────────────────────────────────────────────────────────────

/**
 * What we stash in the Cache while waiting for admin confirmation.
 * TariffUpload is fully serialisable (no functions, Dates survive JSON roundtrip
 * after we re-parse them).
 */
interface PendingTariffConfirmation {
    upload: TariffUpload;
}

// ─── Step 1 — Document handler ────────────────────────────────────────────────

/**
 * Called from client.ts whenever a "document" message arrives.
 * Returns true if the document was recognised as a tariff CSV and handled,
 * false if it should be ignored (e.g. wrong mime type).
 */
export async function handleTariffDocument(
    phoneNumberId: string,
    message: Message,
): Promise<boolean> {
    // Only handle CSV / plain-text documents
    const mimeType = message.documentMimeType ?? '';
    const filename  = (message.documentFilename ?? '').toLowerCase();

    const isCsv =
        mimeType === 'text/csv' ||
        mimeType === 'text/plain' ||
        mimeType === 'application/csv' ||
        filename.endsWith('.csv');

    if (!isCsv) return false;

    console.log(
        `[Tariff Controller] CSV document received from ${message.senderPhoneNumber} ` +
        `(file: "${message.documentFilename}", mime: "${mimeType}")`,
    );

    try {
        // Download the document from WhatsApp
        const mediaUrl    = await GraphApi.getMediaUrl(message.documentId as string);
        const csvBuffer   = await GraphApi.downloadMedia(mediaUrl);

        // Parse
        const { data: upload, errors } = parseTariffCsv(csvBuffer);

        if (errors.length > 0 || !upload) {
            await GraphApi.sendTextMessage(
                message.id,
                phoneNumberId,
                message.senderPhoneNumber,
                formatTariffParseErrorMessage(errors),
            );
            return true;
        }

        // Ask for confirmation
        const reviewText = formatTariffReviewMessage(upload);

        const outgoingMessage = await GraphApi.messageWithInteractiveReply(
            message.id,
            phoneNumberId,
            message.senderPhoneNumber,
            reviewText,
            [
                { id: REPLY_ID.CONFIRM, title: '✅ Confirmar' },
                { id: REPLY_ID.CANCEL,  title: '❌ Cancelar'  },
            ],
        ) as { messages?: Array<{ id: string }> };

        const outgoingMessageId = outgoingMessage?.messages?.[0]?.id;

        if (!outgoingMessageId) {
            console.warn('[Tariff Controller] Could not retrieve outgoing message ID; aborting.');
            await GraphApi.sendTextMessage(
                message.id,
                phoneNumberId,
                message.senderPhoneNumber,
                '⚠️ Hubo un problema al enviar la confirmación. Por favor, reenviá el archivo.',
            );
            return true;
        }

        const pending: PendingTariffConfirmation = { upload };
        await Cache.set(pendingCacheKey(outgoingMessageId), JSON.stringify(pending));

        console.log(
            `[Tariff Controller] Review sent; pending state cached under key: ${pendingCacheKey(outgoingMessageId)}`,
        );

        return true;
    } catch (error) {
        console.error('[Tariff Controller] Error handling tariff document:', error);
        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            message.senderPhoneNumber,
            '❌ Ocurrió un error inesperado al procesar el archivo. Revisá los logs.',
        );
        return true;
    }
}

// ─── Step 2 — Interactive reply handler ───────────────────────────────────────

/**
 * Handles the ✅ Confirmar / ❌ Cancelar reply.
 * Returns true if this reply belonged to a tariff confirmation flow.
 */
export async function handleTariffInteractiveReply(
    phoneNumberId: string,
    message: Message,
): Promise<boolean> {
    const contextMessageId = message.contextMessageId;
    if (!contextMessageId) return false;

    const cacheKey = pendingCacheKey(contextMessageId);
    const cached   = await Cache.get(cacheKey);
    if (!cached) return false;

    let pending: PendingTariffConfirmation;
    try {
        pending = JSON.parse(cached) as PendingTariffConfirmation;
        // Re-hydrate the Date (JSON.parse gives a string)
        pending.upload.validFrom = new Date(pending.upload.validFrom);
    } catch {
        console.error('[Tariff Controller] Failed to parse cached tariff pending state');
        return false;
    }

    await Cache.remove(cacheKey);

    const replyId = message.interactiveReplyId;
    console.log(`[Tariff Controller] Interactive reply received — replyId: "${replyId}"`);

    if (replyId === REPLY_ID.CANCEL) {
        await GraphApi.sendTextMessage(
            message.id,
            phoneNumberId,
            message.senderPhoneNumber,
            '❌ Carga de tarifas cancelada. No se realizaron cambios.',
        );
        console.log('[Tariff Controller] Tariff upload cancelled by admin.');
        return true;
    }

    if (replyId === REPLY_ID.CONFIRM) {
        try {
            const result = await saveTariffPeriod(prisma, pending.upload);

            await GraphApi.sendTextMessage(
                message.id,
                phoneNumberId,
                message.senderPhoneNumber,
                formatTariffSuccessMessage(result),
            );

            console.log(
                `[Tariff Controller] Tariff period "${result.label}" saved ` +
                `(id=${result.periodId}, ${result.ratesCreated} rates, wasUpdate=${result.wasUpdate}).`,
            );
        } catch (error) {
            console.error('[Tariff Controller] Error saving tariff period:', error);
            await GraphApi.sendTextMessage(
                message.id,
                phoneNumberId,
                message.senderPhoneNumber,
                '❌ Ocurrió un error al guardar las tarifas. Revisá los logs.',
            );
        }
        return true;
    }

    console.warn(`[Tariff Controller] Unexpected replyId "${replyId}" for tariff confirmation`);
    return true; // we own this context — consume it
}