import { GraphApi } from './graph-api';
import { Message, RawMessage } from './message';
import { Status, RawStatus } from './status';
import { Cache } from '../../shared/utils';
import { handleMeasurementMessage } from '../bultos/controllers';
import { handleRemitoMessage, handleRemitoInteractiveReply } from '../remitos/controllers';
import { handleMatchTrigger } from '../match/controllers';
import { handleAdminCommand, handleAdminInteractiveReply } from '../admin/controllers';

export class Conversation {
	static async handleMessage(
		senderPhoneNumberId: string,
		rawMessage: RawMessage,
	): Promise<void> {
		const message = new Message(rawMessage);

		switch (message.type) {
			case 'text': {
				// Admin commands take priority (they start with a known keyword prefix)
				const handledByAdmin = await handleAdminCommand(senderPhoneNumberId, message);
				if (handledByAdmin) break;

				// "match" trigger
				const handledByMatch = await handleMatchTrigger(senderPhoneNumberId, message);
				if (handledByMatch) break;

				// Default: delivery measurement
				await handleMeasurementMessage(senderPhoneNumberId, message);
				break;
			}

			case 'image': {
				await handleRemitoMessage(senderPhoneNumberId, message);
				break;
			}

			case 'interactive': {
				// Try admin reply first, then remito reply
				const handledByAdmin = await handleAdminInteractiveReply(senderPhoneNumberId, message);
				if (handledByAdmin) break;

				const handledByRemito = await handleRemitoInteractiveReply(senderPhoneNumberId, message);
				if (!handledByRemito) {
					await GraphApi.sendTextMessage(
						message.id,
						senderPhoneNumberId,
						message.senderPhoneNumber,
						'No entendí tu respuesta. Por favor, usá los botones que te enviamos.',
					);
				}
				break;
			}

			default:
				await GraphApi.sendTextMessage(
					message.id,
					senderPhoneNumberId,
					message.senderPhoneNumber,
					'Sorry, I can only process text and image messages for now.',
				);
				break;
		}
	}

	static async handleStatus(
		senderPhoneNumberId: string,
		rawStatus: RawStatus,
	): Promise<void> {
		const status = new Status(rawStatus);

		if (status.status !== 'delivered' && status.status !== 'read') {
			return;
		}

		if (await Cache.remove(status.messageId)) {
			await GraphApi.sendTextMessage(
				undefined,
				senderPhoneNumberId,
				status.recipientPhoneNumber,
				'Sorry, I can only process text and image messages for now.',
			);
		}
	}
}