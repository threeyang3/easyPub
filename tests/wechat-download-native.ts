import { downloadWechatImage } from '../utils/wechatDownload';
import { createServer } from 'http';

// Explicit opt-in integration check: public image GETs only, no notes/accounts.
export async function run() {
  const source = 'https://www.baidu.com/img/flexible/logo/pc/result.png';
  const checks: string[] = [];
  const bytes = await downloadWechatImage(source);
  if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) throw new Error('Expected public PNG');
  checks.push(`native PNG download: ${bytes.length} bytes`);
  for (const [limit, timeout, expected] of [[8, 15000, '超过']] as const) {
    try { await downloadWechatImage(source, undefined, limit, timeout); throw new Error('Expected bounded failure'); }
    catch (error) {
      if (!(error as Error).message.includes(expected)) throw error;
      checks.push(`native download stopped: ${expected}`);
    }
  }
  // Controlled slow local server, reached only by this test transport override.
  // Production URL validation continues to reject loopback image sources.
  let received = false;
  let disconnected = false;
  const server = createServer((_request, response) => {
    received = true;
    response.on('close', () => { disconnected = true; });
    response.writeHead(200); response.write('pending');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const net = require('electron').remote.net;
    try {
      await downloadWechatImage(source, options => net.request({ ...options, url: `http://127.0.0.1:${port}/` }), undefined, 100);
      throw new Error('Expected timeout');
    } catch (error) {
      if (!(error as Error).message.includes('超时')) throw error;
      for (let attempt = 0; attempt < 20 && !disconnected; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
      if (!received || !disconnected) throw new Error('Expected server connection and actual abort disconnect');
      checks.push('native stalled response aborted and server disconnected');
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  return { checks, vaultWrites: 0, wechatRequests: 0 };
}
