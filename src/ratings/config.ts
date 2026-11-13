import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createPool } from 'mysql2/promise';

export function ratingsPoolFromEnvironment() {
  const socketPath = process.env.TPV_RATINGS_MYSQL_SOCKET, database = process.env.TPV_RATINGS_MYSQL_DATABASE,
    user = process.env.TPV_RATINGS_MYSQL_USER, file = process.env.TPV_RATINGS_MYSQL_PASSWORD_FILE;
  if (!socketPath || !isAbsolute(socketPath) || /[\x00-\x1f\x7f]/.test(socketPath) ||
      !database || !/^[A-Za-z0-9_]{1,64}$/.test(database) || !user || !/^[A-Za-z0-9_.-]{1,64}$/.test(user) ||
      !file || !isAbsolute(file) || /[\x00-\x1f\x7f]/.test(file)) throw new Error('Invalid ratings configuration.');
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 4096 ||
      process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new Error('Invalid ratings configuration.');
  const password = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  if (!password || password.length > 1024) throw new Error('Invalid ratings configuration.');
  return createPool({ socketPath, database, user, password, connectionLimit: 4, waitForConnections: false,
    supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false, connectTimeout: 5000 });
}
