export function formatDeliveryReply(deliveries: any[]): string {
    //mock
    return deliveries.map((delivery) => `Delivery: ${delivery.id}`).join('\n');
}