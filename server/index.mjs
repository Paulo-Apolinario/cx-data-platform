import { resolve } from 'node:path';
import { createApp } from './app.mjs';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida.');
const { server, db } = createApp({
  dataDir: resolve(process.env.DATA_DIR || 'data'),
  origin: process.env.APP_ORIGIN || 'http://localhost:3000',
  production: process.env.NODE_ENV === 'production'
});
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Gestão de Obras: ${process.env.APP_ORIGIN || 'http://localhost:3000'}`));
function stop() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
