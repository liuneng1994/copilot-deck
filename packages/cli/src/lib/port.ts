// Async port picker: try `preferred`, then `preferred+1` … up to `maxTries`.
import { createServer } from "node:net";

export async function pickPort(preferred: number, host: string, maxTries = 20): Promise<number> {
  if (preferred === 0) return await tryListen(0, host);
  let port = preferred;
  let lastErr: unknown;
  for (let i = 0; i < maxTries; i++) {
    try {
      return await tryListen(port, host);
    } catch (e) {
      lastErr = e;
      port++;
    }
  }
  throw new Error(
    `no free port near ${preferred} on ${host} after ${maxTries} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

function tryListen(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.once("error", (err) => {
      srv.close(() => reject(err));
    });
    srv.listen(port, host, () => {
      const addr = srv.address();
      const resolved = typeof addr === "object" && addr ? addr.port : port;
      srv.close(() => resolve(resolved));
    });
  });
}
