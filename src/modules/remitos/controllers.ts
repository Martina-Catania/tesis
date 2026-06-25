import { prisma } from '../../shared/db/prisma';
import { GraphApi } from '../whatsapp/graph-api';
import { Message } from '../whatsapp/message';
import { extractDataFromImage } from './services/gemini';
import { parseRemitoText, hasErrors } from './services/parser';
import { saveRemito, saveRemitoError } from './services/storage';
import { formatRemitoReply } from './services/formatter';

export async function handleRemitoMessage(
    phoneNumberId: string,
    message: Message,
): Promise<void> {
    const date = new Date();
    date.setMilliseconds(0);
    console.log(`[Remitos Controller] Handling remito image from: ${message.senderPhoneNumber}, ` + `messageId: ${message.id}`,);

    try {
        // 1. Resolve and download the image from WhatsApp
        const mediaUrl    = await GraphApi.getMediaUrl(message.imageId as string);
        const imageBuffer = await GraphApi.downloadMedia(mediaUrl);

        // 2. Send the image to Gemini Vision
        const rawText = await extractDataFromImage(imageBuffer);
        console.log(`[Remitos Controller] Gemini raw response: "${rawText}"`);

        // 3. Parse Gemini's response into structured data
        const parsed = parseRemitoText(rawText);

        // 4. Persist — errors go to RemitoError, everything else goes to Remito
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
            });
        }

        console.log(
            `[Remitos Controller] Remito handled successfully for: ${message.senderPhoneNumber}`,
        );

        // 5. Reply to the driver
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