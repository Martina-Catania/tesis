// Raw shape of the webhook message payload from Meta
export interface RawMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
  context?: { id: string };
}

export type MessageType = 'text' | 'image' | 'interactive' | 'unknown' | string;

export class Message {
  id: string;
  senderPhoneNumber: string;
  type: MessageType;
  text?: string;
  imageId?: string | null;
  caption?: string | null;
  contextMessageId?: string;
  interactiveReplyId?: string;

  constructor(rawMessage: RawMessage) {
    this.id = rawMessage.id;
    this.senderPhoneNumber = rawMessage.from;

    const type = rawMessage.type;

    if (type === 'text') {
      this.type = 'text';
      this.text = rawMessage.text?.body ?? '';
    } else if (type === 'image') {
      this.type = 'image';
      this.imageId = rawMessage.image?.id ?? null;
      this.caption = rawMessage.image?.caption ?? null;
    } else if (type === 'interactive') {
      this.type = 'interactive';
      this.contextMessageId = rawMessage.context?.id;
      const interactive = rawMessage.interactive!;
      this.interactiveReplyId =
        interactive.button_reply?.id ?? interactive.list_reply?.id;
    } else {
      this.type = 'unknown';
    }
  }
}