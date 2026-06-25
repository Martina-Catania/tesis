export function formatDeliveryReply(deliveries: any[]): string {
    //mock
    return deliveries.map((delivery) => {
        const client = delivery.client;
        const packages = delivery.packages.map((pkg: any) => `${pkg.quantity}x ${pkg.length}x${pkg.width}x${pkg.height}`).join(", ");
        const errors = delivery.errors.length > 0 ? `Errors: ${delivery.errors.join(", ")}` : "";
        return `Client: ${client}, Packages: [${packages}] ${errors}`;
    }).join("\n");
}