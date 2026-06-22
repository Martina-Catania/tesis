import { GraphApi } from '../whatsapp/graph-api';
import { Message } from '../whatsapp/message';
import { parseDeliveryMessage } from './services/parser';
import { storeDailyMeasurements } from './services/storage';
import { formatDeliveryReply } from './services/formatter';

export async function handleMeasurementMessage(
    phoneNumberId: string,
    message: Message,
): Promise<void> {
    const deliveries = parseDeliveryMessage(message.text as string);
    await storeDailyMeasurements(deliveries);

    await GraphApi.sendTextMessage(
        message.id, phoneNumberId, message.senderPhoneNumber,
        `Medidas guardadas\n${formatDeliveryReply(deliveries)}`,
    );
}