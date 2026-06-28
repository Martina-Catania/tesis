import { prisma } from '../../shared/db/prisma';
import { GraphApi } from '../whatsapp/graph-api';
import { Message } from '../whatsapp/message';
import { extractDataFromImage, GeminiUnavailableError } from './services/gemini';
import { parseRemitoText, hasErrors } from './services/parser';
import { saveRemito, saveRemitoError, findMatchingAddress } from './services/storage';
import { formatRemitoReply } from './services/formatter';
import { findClient } from '../bultos/services/storage';

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

        // 4. Validate the extracted client and address against the DB.
        //    Client is checked first; address is only checked when client resolved.
        let resolvedClientId: number | undefined;
        let resolvedAddressId: number | undefined;

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

        if (resolvedClientId !== undefined && parsed.data.address) {
            const addressMatch = await findMatchingAddress(
                prisma,
                resolvedClientId,
                parsed.data.address,
            );

            if (addressMatch.matched) {
                resolvedAddressId = addressMatch.addressId;
            } else {
                parsed.errors.push(
                    `Dirección desconocida para este cliente: "${parsed.data.address}"`,
                );
            }
        }

        // 5. Persist — anything with errors goes to RemitoError, clean records to Remito
        if (hasErrors(parsed)) {
            await saveRemitoError(prisma, {
                date,
                rawText,
                clientName: parsed.data.clientName,
                address: parsed.data.address,
                packages: parsed.data.packages,
                errors: parsed.errors,
            });
        } else {
            await saveRemito(prisma, {
                date,
                rawText,
                clientName: parsed.data.clientName,
                address: parsed.data.address,
                packages: parsed.data.packages,
                clientId: resolvedClientId,
                addressId: resolvedAddressId,
            });
        }

        console.log(
            `[Remitos Controller] Remito handled successfully for: ${message.senderPhoneNumber}`,
        );

        // 6. Reply to the driver
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