import { setDefaultResultOrder } from 'dns';
import { request as httpsRequest } from 'https';
import type { IncomingMessage } from 'http';

setDefaultResultOrder('ipv4first');

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/**
 * undici fetch는 일부 국내 포털에서 HTTP/2·IPv6·TLS 핸드셰이크로 TypeError: fetch failed 가 난다.
 * HTTP/1.1 + IPv4 강제 https 요청으로 우회한다.
 */
export function httpsGetText(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpsRequest(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        family: 4,
        headers: {
          ...headers,
          Host: parsed.hostname,
          Connection: 'close',
        },
        timeout: timeoutMs,
        servername: parsed.hostname,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function getJsonOrText(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; body: string; json: unknown | null }> {
  const { status, body } = await httpsGetText(url, headers, timeoutMs);
  let json: unknown | null = null;
  const trimmed = body.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      json = JSON.parse(trimmed) as unknown;
    } catch {
      json = null;
    }
  }

  return { status, body, json };
}
