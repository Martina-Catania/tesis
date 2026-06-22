import * as redis from 'redis';
import { config } from '.';

const client = redis.createClient({
  socket: {
    host: config.redisHost,
    port: config.redisPort,
  },
});

client.on('error', (err: Error) => {
  console.error('Redis Client Error', err);
});

void client.connect();

export class Cache {
  /**
   * Inserts a key with a short TTL.
   *
   * As of when this was written, the Redis client doesn't support setting a
   * TTL on set-type members. We use a plain string key with a dummy value
   * and explicit expiry to mimic that behaviour.
   */
  static async insert(key: string): Promise<void> {
    await client.set(key, '');
    // Most "delivered / read" webhooks arrive within ~15 seconds.
    await client.expire(key, 15);
  }

  /**
   * Removes a key and returns true if it existed.
   *
   * Optionally, you can measure ingress latency from Cloud API webhooks via
   * Redis's remaining TTL before deletion:
   *   someLoggingFunc(await client.ttl(key));
   */
  static async remove(key: string): Promise<boolean> {
    const resp = await client.del(key);
    return resp > 0;
  }
}