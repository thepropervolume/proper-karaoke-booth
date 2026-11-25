import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { SingerProfileDetails } from '../domain/singer-profile-details';
import type { AccountLink, AccountSession, AccountStore, BoothAccount } from './mobile-accounts';

type AccountRow = RowDataPacket & BoothAccount;
type LinkRow = RowDataPacket & AccountLink;
const ACCOUNT_COLUMNS = 'a.id,a.email,a.name,a.password_hash AS passwordHash';
const LINK_COLUMNS = 'email,kind AS type,name,password_hash AS passwordHash,account_id AS accountId,expires_at AS expires';

export class MySqlMobileAccountStore implements AccountStore {
  constructor(private readonly pool: Pool) {}

  async check(): Promise<void> {
    await this.pool.execute(`SELECT ${ACCOUNT_COLUMNS} FROM booth_accounts a LIMIT 0`);
    await this.pool.execute(`SELECT ${LINK_COLUMNS},token_hash FROM booth_account_links LIMIT 0`);
    await this.pool.execute('SELECT token_hash,account_id,expires_at FROM booth_account_sessions LIMIT 0');
    await this.pool.execute('SELECT account_id,pronouns,bio,avatar FROM booth_account_profiles LIMIT 0');
  }

  async profileDetails(accountId: number): Promise<SingerProfileDetails | null> {
    const [rows] = await this.pool.execute<(RowDataPacket & SingerProfileDetails)[]>(
      'SELECT pronouns,bio,avatar FROM booth_account_profiles WHERE account_id=?', [accountId]);
    const row = rows[0];
    return row ? { pronouns: row.pronouns, bio: row.bio, avatar: row.avatar } : null;
  }

  async saveProfileDetails(accountId: number, details: SingerProfileDetails): Promise<void> {
    await this.pool.execute(`INSERT INTO booth_account_profiles (account_id,pronouns,bio,avatar) VALUES (?,?,?,?)
      ON DUPLICATE KEY UPDATE pronouns=?,bio=?,avatar=?`,
      [accountId, details.pronouns, details.bio, details.avatar, details.pronouns, details.bio, details.avatar]);
  }

  async account(email: string): Promise<BoothAccount | null> {
    const [rows] = await this.pool.execute<AccountRow[]>(`SELECT ${ACCOUNT_COLUMNS} FROM booth_accounts a WHERE a.email=?`, [email]);
    return rows[0] ?? null;
  }

  async session(tokenHash: string, now: number): Promise<BoothAccount | null> {
    const [rows] = await this.pool.execute<AccountRow[]>(`SELECT ${ACCOUNT_COLUMNS} FROM booth_account_sessions s
      INNER JOIN booth_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?`, [tokenHash, now]);
    return rows[0] ?? null;
  }

  async addSession(account: BoothAccount, session: AccountSession, now: number): Promise<boolean> {
    await this.pool.execute('DELETE FROM booth_account_sessions WHERE expires_at<=? LIMIT 100', [now]);
    // The verifier comparison prevents an old password from minting a session after a concurrent reset.
    const [result] = await this.pool.execute<ResultSetHeader>(`INSERT INTO booth_account_sessions (token_hash,account_id,expires_at)
      SELECT ?,id,? FROM booth_accounts WHERE id=? AND password_hash=?`, [session.tokenHash, session.expires, account.id, account.passwordHash]);
    return result.affectedRows === 1;
  }

  async removeSession(tokenHash: string): Promise<void> {
    await this.pool.execute('DELETE FROM booth_account_sessions WHERE token_hash=?', [tokenHash]);
  }

  async addLink(tokenHash: string, link: AccountLink, now: number): Promise<void> {
    await this.pool.execute('DELETE FROM booth_account_links WHERE expires_at<=? LIMIT 100', [now]);
    await this.pool.execute(`INSERT INTO booth_account_links (token_hash,email,kind,name,password_hash,account_id,expires_at)
      VALUES (?,?,?,?,?,?,?)`, [tokenHash, link.email, link.type, link.name, link.passwordHash, link.accountId, link.expires]);
  }

  async removeLink(tokenHash: string): Promise<void> {
    await this.pool.execute('DELETE FROM booth_account_links WHERE token_hash=?', [tokenHash]);
  }

  async link(tokenHash: string, now: number): Promise<AccountLink | null> {
    const [rows] = await this.pool.execute<LinkRow[]>(`SELECT ${LINK_COLUMNS} FROM booth_account_links WHERE token_hash=? AND expires_at>?`, [tokenHash, now]);
    return rows[0] ?? null;
  }

  async redeem(tokenHash: string, proof: AccountLink, updatedPassword: string | null, session: AccountSession, now: number): Promise<BoothAccount | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [links] = await connection.execute<LinkRow[]>(`SELECT ${LINK_COLUMNS}
        FROM booth_account_links WHERE token_hash=? AND expires_at>? FOR UPDATE`, [tokenHash, now]);
      const link = links[0];
      if (!link || link.type !== proof.type || link.passwordHash !== proof.passwordHash) {
        await connection.rollback();
        return null;
      }
      const account = await this.claim(connection, link, updatedPassword);
      if (!account) {
        await connection.rollback();
        return null;
      }
      if (link.type === 'reset') {
        await connection.execute('DELETE FROM booth_account_sessions WHERE account_id=?', [account.id]);
        await connection.execute('DELETE FROM booth_account_links WHERE email=?', [link.email]);
      } else if (link.type === 'register') {
        await connection.execute('DELETE FROM booth_account_links WHERE email=? AND kind=\'register\'', [link.email]);
      } else {
        await connection.execute('DELETE FROM booth_account_links WHERE token_hash=?', [tokenHash]);
      }
      await connection.execute('INSERT INTO booth_account_sessions (token_hash,account_id,expires_at) VALUES (?,?,?)',
        [session.tokenHash, account.id, session.expires]);
      await connection.commit();
      return account;
    } catch (error) {
      try { await connection.rollback(); }
      catch { connection.destroy(); }
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') return null;
      throw error;
    } finally {
      connection.release();
    }
  }

  private async claim(connection: PoolConnection, link: AccountLink, updatedPassword: string | null): Promise<BoothAccount | null> {
    if (link.type === 'register') {
      if (!link.name || !link.passwordHash) return null;
      const [result] = await connection.execute<ResultSetHeader>('INSERT INTO booth_accounts (email,name,password_hash) VALUES (?,?,?)',
        [link.email, link.name, link.passwordHash]);
      return { id: result.insertId, email: link.email, name: link.name, passwordHash: link.passwordHash };
    }
    const [accounts] = await connection.execute<AccountRow[]>(`SELECT ${ACCOUNT_COLUMNS} FROM booth_accounts a WHERE a.id=? AND a.email=? FOR UPDATE`,
      [link.accountId, link.email]);
    const account = accounts[0];
    if (!account) return null;
    if (link.type === 'reset') {
      if (!updatedPassword) return null;
      await connection.execute('UPDATE booth_accounts SET password_hash=? WHERE id=?', [updatedPassword, account.id]);
      account.passwordHash = updatedPassword;
    }
    return account;
  }
}