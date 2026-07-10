import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

// ---- Types ----

export interface UserRecord {
  accountId: string;
  username: string;
  passwordHash: string;   // "pbkdf2$iterations$salt$hash"
  registrationIp: string;
  createdAt: string;      // ISO 8601
}

export interface UserDatabase {
  accounts: UserRecord[];
  ipRegistrations: Record<string, string>;  // ip → accountId
  nextAccountId: number;
}

export interface AuthResult {
  success: boolean;
  accountId?: string;
  username?: string;
  token?: string;
  error?: string;
}

interface Session {
  accountId: string;
  username: string;
  createdAt: number;
}

// ---- Constants ----

const TOKEN_BYTES = 32;
const SALT_BYTES = 16;
const HASH_ITERATIONS = 100_000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const USERNAME_REGEX = /^[a-zA-Z0-9_一-鿿]{3,12}$/;
const MIN_PASSWORD_LEN = 4;

// ---- AuthManager ----

export class AuthManager {
  private dbPath: string;
  private sessions: Map<string, Session> = new Map();

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.ensureDb();
  }

  // ================================================================
  // Public API
  // ================================================================

  register(username: string, password: string, ip: string): AuthResult {
    // Validate inputs
    const usernameTrimmed = username.trim();
    if (!USERNAME_REGEX.test(usernameTrimmed)) {
      return { success: false, error: '用户名需3-12字符（字母/数字/下划线/中文）' };
    }
    if (password.length < MIN_PASSWORD_LEN) {
      return { success: false, error: '密码至少需要4个字符' };
    }

    const db = this.loadDb();

    // Check IP uniqueness
    const normalizedIp = this.normalizeIp(ip);
    if (db.ipRegistrations[normalizedIp]) {
      return { success: false, error: '该IP已注册过账号' };
    }

    // Check username uniqueness (case-insensitive)
    const existing = db.accounts.find(
      a => a.username.toLowerCase() === usernameTrimmed.toLowerCase()
    );
    if (existing) {
      return { success: false, error: '用户名已被使用' };
    }

    // Create account
    const accountId = this.generateAccountId(db.nextAccountId);
    const passwordHash = this.hashPassword(password);
    const now = new Date().toISOString();

    const record: UserRecord = {
      accountId,
      username: usernameTrimmed,
      passwordHash,
      registrationIp: normalizedIp,
      createdAt: now,
    };

    db.accounts.push(record);
    db.ipRegistrations[normalizedIp] = accountId;
    db.nextAccountId++;

    this.saveDb(db);

    // Generate session token
    const token = this.generateToken();
    this.sessions.set(token, {
      accountId,
      username: usernameTrimmed,
      createdAt: Date.now(),
    });

    console.log(`[auth] Registered: ${usernameTrimmed} (${accountId}) from ${normalizedIp}`);
    return { success: true, accountId, username: usernameTrimmed, token };
  }

  login(identifier: string, password: string): AuthResult {
    const db = this.loadDb();
    const idTrimmed = identifier.trim();

    // Match by accountId first, then by username (case-insensitive)
    let user = db.accounts.find(a => a.accountId === idTrimmed);
    if (!user) {
      user = db.accounts.find(
        a => a.username.toLowerCase() === idTrimmed.toLowerCase()
      );
    }

    if (!user) {
      return { success: false, error: '账号或密码错误' };
    }

    if (!this.verifyPassword(password, user.passwordHash)) {
      return { success: false, error: '账号或密码错误' };
    }

    // Generate session token
    const token = this.generateToken();
    this.sessions.set(token, {
      accountId: user.accountId,
      username: user.username,
      createdAt: Date.now(),
    });

    console.log(`[auth] Login: ${user.username} (${user.accountId})`);
    return { success: true, accountId: user.accountId, username: user.username, token };
  }

  logout(token: string): void {
    this.sessions.delete(token);
  }

  validateSession(token: string): { accountId: string; username: string } | null {
    const session = this.sessions.get(token);
    if (!session) return null;

    // Check TTL
    if (Date.now() - session.createdAt > TOKEN_TTL_MS) {
      this.sessions.delete(token);
      return null;
    }

    return { accountId: session.accountId, username: session.username };
  }

  /** Get client IP from Express request or Socket.IO handshake */
  getClientIp(req: { ip?: string; headers?: Record<string, string | string[] | undefined>; connection?: { remoteAddress?: string } }): string {
    // Check x-forwarded-for (when behind nginx/Render proxy)
    const xff = req.headers?.['x-forwarded-for'];
    if (xff) {
      const ip = Array.isArray(xff) ? xff[0] : xff.split(',')[0];
      return ip.trim();
    }
    // Express req.ip (trust proxy must be set)
    if (req.ip && req.ip !== '::1' && req.ip !== '127.0.0.1') {
      return req.ip;
    }
    // Fallback to connection remoteAddress
    return req.connection?.remoteAddress || '127.0.0.1';
  }

  // ================================================================
  // Internal
  // ================================================================

  private hashPassword(password: string): string {
    const salt = randomBytes(SALT_BYTES).toString('hex');
    const hash = pbkdf2Sync(password, salt, HASH_ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
    return `pbkdf2$${HASH_ITERATIONS}$${salt}$${hash}`;
  }

  private verifyPassword(password: string, stored: string): boolean {
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iterations = parseInt(parts[1], 10);
    const salt = parts[2];
    const storedHash = parts[3];
    const computedHash = pbkdf2Sync(password, salt, iterations, KEY_LENGTH, DIGEST).toString('hex');
    try {
      return timingSafeEqual(Buffer.from(computedHash), Buffer.from(storedHash));
    } catch {
      return false;
    }
  }

  private generateToken(): string {
    return randomBytes(TOKEN_BYTES).toString('hex');
  }

  private generateAccountId(nextId: number): string {
    return 'A' + String(nextId).padStart(6, '0');
  }

  private normalizeIp(ip: string): string {
    // IPv6 localhost → IPv4
    if (ip === '::1' || ip === '::ffff:127.0.0.1') return '127.0.0.1';
    return ip;
  }

  // ================================================================
  // Persistence
  // ================================================================

  private ensureDb(): void {
    const dir = path.dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    if (!existsSync(this.dbPath)) {
      const initial: UserDatabase = {
        accounts: [],
        ipRegistrations: {},
        nextAccountId: 1,
      };
      writeFileSync(this.dbPath, JSON.stringify(initial, null, 2), 'utf-8');
      console.log(`[auth] Created new user database at ${this.dbPath}`);
    }
  }

  private loadDb(): UserDatabase {
    try {
      const raw = readFileSync(this.dbPath, 'utf-8');
      return JSON.parse(raw) as UserDatabase;
    } catch (e) {
      console.error('[auth] Failed to read user database, starting fresh:', e);
      return { accounts: [], ipRegistrations: {}, nextAccountId: 1 };
    }
  }

  private saveDb(db: UserDatabase): void {
    writeFileSync(this.dbPath, JSON.stringify(db, null, 2), 'utf-8');
  }
}
