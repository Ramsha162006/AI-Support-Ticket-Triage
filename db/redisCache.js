import { createClient } from 'redis';

export function createRedisCache() {
  let client = null;
  let connected = false;

  async function init() {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) {
      return false;
    }

    try {
      client = createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 4000,
          reconnectStrategy: (retries) => {
            if (retries > 3) return false;
            return Math.min(retries * 200, 1000);
          },
        },
      });

      client.on('error', (err) => {
        if (connected) {
          console.warn('[Redis] Cache connection error:', err.message);
        }
        connected = false;
      });

      client.on('ready', () => {
        connected = true;
      });

      await client.connect();
      connected = true;
      return true;
    } catch (err) {
      console.warn('[Redis] Unavailable, continuing without cache:', err.message);
      connected = false;
      try {
        if (client?.isOpen) {
          await client.quit();
        }
      } catch {
        // Ignore cleanup errors
      }
      client = null;
      return false;
    }
  }

  async function get(key) {
    if (!connected || !client) return null;
    try {
      const raw = await client.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function set(key, value, ttlSeconds = 60) {
    if (!connected || !client) return false;
    try {
      await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return true;
    } catch {
      return false;
    }
  }

  async function del(key) {
    if (!connected || !client) return false;
    try {
      await client.del(key);
      return true;
    } catch {
      return false;
    }
  }

  function isConnected() {
    return connected;
  }

  async function close() {
    if (client?.isOpen) {
      await client.quit();
    }
    connected = false;
  }

  return {
    init,
    get,
    set,
    del,
    isConnected,
    close,
  };
}
