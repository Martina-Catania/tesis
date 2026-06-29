import { prisma } from '../../shared/db/prisma';
import { findClient } from '../../shared/db/client';
import { GraphApi } from '../whatsapp/graph-api';
import { Message } from '../whatsapp/message';
import { parseDeliveryMessage, hasErrors } from './services/parser';
import { findActiveTariffPeriod, saveDelivery, saveDeliveryError } from './services/storage';
import { formatDeliveryReply } from './services/formatter';

export async function handleMeasurementMessage(
    phoneNumberId: string,
    message: Message,
): Promise<void> {
    console.log(`[Bultos Controller] Handling measurement message from: ${message.senderPhoneNumber}, messageId: ${message.id}`);

    try {
        const { date, deliveries } = await parseDeliveryMessage(prisma, message.text as string);

        if (deliveries.length === 0) {
            console.log(`[Bultos Controller] Message contains no deliveries, ignoring: ${message.senderPhoneNumber}`);
            return;
        }

        const period = await findActiveTariffPeriod(prisma, date);

        for (const delivery of deliveries) {
            if (hasErrors(delivery)) {
                await saveDeliveryError(prisma, {
                    rawMessage: message.text as string,
                    date,
                    clientName: delivery.client,
                    packages: delivery.packages,
                    errors: delivery.errors,
                });
            } else {
                const client = await findClient(prisma, delivery.client);
                await saveDelivery(prisma, {
                    clientId: client!.id,
                    date,
                    periodId: period?.id,
                    packages: delivery.packages,
                });
            }
        }

        console.log(`[Bultos Controller] Measurement message handled successfully for: ${message.senderPhoneNumber}`);

        await GraphApi.sendTextMessage(
            message.id, phoneNumberId, message.senderPhoneNumber,
            `Medidas guardadas\n${formatDeliveryReply(deliveries)}`,
        );
    } catch (error) {
        console.error(`[Bultos Controller] Error handling measurement message from: ${message.senderPhoneNumber}:`, error);
        throw error;
    }
}