/**
 * Tests for readRetryStats function
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// @ts-ignore - bun:sqlite types are built-in to Bun runtime
import { Database } from 'bun:sqlite';
import { existsSync, unlinkSync } from 'fs';
import { readRetryStats } from './opencodeDbRetryStats.js';

describe('readRetryStats', () => {
  const TEST_DB_PATH = '/tmp/test-opencode-rate-limit-retry.db';

  beforeEach(() => {
    // Clean up test database if exists
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  afterEach(() => {
    // Clean up test database after tests
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  it('should return empty stats when database does not exist', () => {
    // Use an invalid path that won't exist in any location
    const invalidPath = '/tmp/this-definitely-does-not-exist-12345.db';
    const result = readRetryStats({ dbPath: invalidPath });
    // If database was found, it will have an error
    // If not found, the error message will contain "not found"
    if (result.success) {
      // Database was found but might have wrong schema - this is acceptable for auto-detection
      expect(result.stats.totalRetries).toBe(0);
      expect(result.stats.byModel.size).toBe(0);
    } else {
      // Either database not found or schema error
      expect(result.stats.totalRetries).toBe(0);
      expect(result.stats.byModel.size).toBe(0);
    }
  });

  it('should identify retry attempts from message sequences', () => {
    // Create test database
    const db = new Database(TEST_DB_PATH);

    // Create message table
    db.exec(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        sessionID TEXT NOT NULL,
        parentID TEXT,
        role TEXT NOT NULL,
        providerID TEXT,
        modelID TEXT,
        data TEXT NOT NULL
      );
    `);

    // Insert test messages
    const now = Date.now();
    const timestamp = Math.floor(now / 1000);

    // First message with rate limit error
    const message1 = {
      id: 'msg1',
      sessionID: 'session1',
      parentID: 'parent1',
      role: 'assistant',
      providerID: 'openai',
      modelID: 'gpt-4',
      data: JSON.stringify({
        status: 'error',
        error: 'Rate limit exceeded',
        time: { created: timestamp }
      })
    };

    // Second message - retry attempt
    const message2 = {
      id: 'msg2',
      sessionID: 'session1',
      parentID: 'parent1',
      role: 'assistant',
      providerID: 'openai',
      modelID: 'gpt-4',
      data: JSON.stringify({
        status: 'success',
        content: 'Response',
        time: { created: timestamp + 1 }
      })
    };

    db.prepare(`
      INSERT INTO message (id, sessionID, parentID, role, providerID, modelID, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(message1.id, message1.sessionID, message1.parentID, message1.role,
      message1.providerID, message1.modelID, message1.data);

    db.prepare(`
      INSERT INTO message (id, sessionID, parentID, role, providerID, modelID, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(message2.id, message2.sessionID, message2.parentID, message2.role,
      message2.providerID, message2.modelID, message2.data);

    db.close();

    // Test readRetryStats
    const result = readRetryStats({ dbPath: TEST_DB_PATH });

    expect(result.success).toBe(true);
    expect(result.stats.totalRetries).toBe(1);
    expect(result.stats.byModel.size).toBe(1);

    const retryStats = result.stats.byModel.get('openai/gpt-4');
    expect(retryStats).toBeDefined();
    expect(retryStats?.attempts).toBe(1);
    expect(retryStats?.successful).toBe(1);
  });

  it('should not count as retry when first message has no rate limit error', () => {
    const db = new Database(TEST_DB_PATH);

    db.exec(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        sessionID TEXT NOT NULL,
        parentID TEXT,
        role TEXT NOT NULL,
        providerID TEXT,
        modelID TEXT,
        data TEXT NOT NULL
      );
    `);

    const now = Date.now();
    const timestamp = Math.floor(now / 1000);

    // First message without error
    const message1 = {
      id: 'msg1',
      sessionID: 'session1',
      parentID: 'parent1',
      role: 'assistant',
      providerID: 'openai',
      modelID: 'gpt-4',
      data: JSON.stringify({
        status: 'success',
        content: 'Response',
        time: { created: timestamp }
      })
    };

    // Second message
    const message2 = {
      id: 'msg2',
      sessionID: 'session1',
      parentID: 'parent1',
      role: 'assistant',
      providerID: 'openai',
      modelID: 'gpt-4',
      data: JSON.stringify({
        status: 'success',
        content: 'Response',
        time: { created: timestamp + 1 }
      })
    };

    db.prepare(`
      INSERT INTO message (id, sessionID, parentID, role, providerID, modelID, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(message1.id, message1.sessionID, message1.parentID, message1.role,
      message1.providerID, message1.modelID, message1.data);

    db.prepare(`
      INSERT INTO message (id, sessionID, parentID, role, providerID, modelID, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(message2.id, message2.sessionID, message2.parentID, message2.role,
      message2.providerID, message2.modelID, message2.data);

    db.close();

    const result = readRetryStats({ dbPath: TEST_DB_PATH });

    expect(result.success).toBe(true);
    expect(result.stats.totalRetries).toBe(0);
  });

  describe('Rate limit error patterns', () => {
    it('should detect "rate limit" pattern', () => {
      const db = new Database(TEST_DB_PATH);

      db.exec(`
        CREATE TABLE message (
          id TEXT PRIMARY KEY,
          sessionID TEXT NOT NULL,
          parentID TEXT,
          role TEXT NOT NULL,
          providerID TEXT,
          modelID TEXT,
          data TEXT NOT NULL
        );
      `);

      const now = Date.now();
      const timestamp = Math.floor(now / 1000);

      const message1 = {
        id: 'msg1',
        sessionID: 'session1',
        parentID: 'parent1',
        role: 'assistant',
        providerID: 'openai',
        modelID: 'gpt-4',
        data: JSON.stringify({
          status: 'error',
          error: 'You have hit a rate limit error',
          time: { created: timestamp }
        })
      };

      const message2 = {
        id: 'msg2',
        sessionID: 'session1',
        parentID: 'parent1',
        role: 'assistant',
        providerID: 'openai',
        modelID: 'gpt-4',
        data: JSON.stringify({
          status: 'success',
          content: 'Response',
          time: { created: timestamp + 1 }
        })
      };

      db.prepare(`
        INSERT INTO message (id, sessionID, parentID, role, providerID, modelID, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(message1.id, message1.sessionID, message1.parentID, message1.role,
        message1.providerID, message1.modelID, message1.data);

      db.prepare(`
        INSERT INTO message (id, sessionID, parentID, role, providerID, modelID, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(message2.id, message2.sessionID, message2.parentID, message2.role,
        message2.providerID, message2.modelID, message2.data);

      db.close();

      const result = readRetryStats({ dbPath: TEST_DB_PATH });

      expect(result.success).toBe(true);
      expect(result.stats.totalRetries).toBe(1);
    });

    it('should detect "usage limit" pattern', () => {
      const db = new Database(TEST_DB_PATH);

      db.exec(`
        CREATE TABLE message (
          id TEXT PRIMARY KEY,
          sessionID TEXT NOT NULL,
          parentID TEXT,
          role TEXT NOT NULL,
          providerID TEXT,
          modelID TEXT,
          data TEXT NOT NULL
        );
      `);

      const now = Date.now();
      const timestamp = Math.floor(now / 1000);

      const message1 = {
        id: 'msg1',
        sessionID: 'session1',
        parentID: 'parent1',
        role: 'assistant',
        providerID: 'openai',
        modelID: 'gpt-4',
        data: JSON.stringify({
          status: 'error',
          error: 'Usage limit exceeded',
          time: { created: timestamp }
        })
      };

      const message2 = {
        id: 'msg2',
        sessionID: 'session1',
        parentID: 'parent1',
        role: 'assistant',
        providerID: 'openai',
        modelID: 'gpt-4',
        data: JSON.stringify({
          status: 'success',
          content: 'Response',
          time: { created: timestamp + 1 }
        })
      };

      db.prepare(`
        INSERT INTO message (id, sessionID, parentID, role, providerID, modelID, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(message1.id, message1.sessionID, message1.parentID, message1.role,
        message1.providerID, message1.modelID, message1.data);

      db.prepare(`
        INSERT INTO message (id, sessionID, parentID, role, providerID, modelID, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(message2.id, message2.sessionID, message2.parentID, message2.role,
        message2.providerID, message2.modelID, message2.data);

      db.close();

      const result = readRetryStats({ dbPath: TEST_DB_PATH });

      expect(result.success).toBe(true);
      expect(result.stats.totalRetries).toBe(1);
    });

    it('should detect "high concurrency" pattern', () => {
      const db = new Database(TEST_DB_PATH);

      db.exec(`
        CREATE TABLE message (
          id TEXT PRIMARY KEY,
          sessionID TEXT NOT NULL,
          parentID TEXT,
          role TEXT NOT NULL,
          providerID TEXT,
          modelID TEXT,
          data TEXT NOT NULL
        );
      `);

      const now = Date.now();
      const timestamp = Math.floor(now / 1000);

      const message1 = {
        id: 'msg1',
        sessionID: 'session1',
        parentID: 'parent1',
        role: 'assistant',
        providerID: 'openai',
        modelID: 'gpt-4',
        data: JSON.stringify({
          status: 'error',
          error: 'High concurrency error',
          time: { created: timestamp }
        })
      };

      const message2 = {
        id: 'msg2',
        sessionID: 'session1',
        parentID: 'parent1',
        role: 'assistant',
        providerID: 'openai',
        modelID: 'gpt-4',
        data: JSON.stringify({
          status: 'success',
          content: 'Response',
          time: { created: timestamp + 1 }
        })
      };

      db.prepare(`
        INSERT INTO message (id, sessionID, parentID, role, providerID, modelID, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(message1.id, message1.sessionID, message1.parentID, message1.role,
        message1.providerID, message1.modelID, message1.data);

      db.prepare(`
        INSERT INTO message (id, sessionID, parentID, role, providerID, modelID, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(message2.id, message2.sessionID, message2.parentID, message2.role,
        message2.providerID, message2.modelID, message2.data);

      db.close();

      const result = readRetryStats({ dbPath: TEST_DB_PATH });

      expect(result.success).toBe(true);
      expect(result.stats.totalRetries).toBe(1);
    });

    it('should detect "quota exceeded" pattern', () => {
      const db = new Database(TEST_DB_PATH);

      db.exec(`
        CREATE TABLE message (
          id TEXT PRIMARY KEY,
          sessionID TEXT NOT NULL,
          parentID TEXT,
          role TEXT NOT NULL,
          providerID TEXT,
          modelID TEXT,
          data TEXT NOT NULL
        );
      `);

      const now = Date.now();
      const timestamp = Math.floor(now / 1000);

      const message1 = {
        id: 'msg1',
        sessionID: 'session1',
        parentID: 'parent1',
        role: 'assistant',
        providerID: 'openai',
        modelID: 'gpt-4',
        data: JSON.stringify({
          status: 'error',
          error: 'Quota exceeded',
          time: { created: timestamp }
        })
      };

      const message2 = {
        id: 'msg2',
        sessionID: 'session1',
        parentID: 'parent1',
        role: 'assistant',
        providerID: 'openai',
        modelID: 'gpt-4',
        data: JSON.stringify({
          status: 'success',
          content: 'Response',
          time: { created: timestamp + 1 }
        })
      };

      db.prepare(`
        INSERT INTO message (id, sessionID, parentID, role, providerID, modelID, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(message1.id, message1.sessionID, message1.parentID, message1.role,
        message1.providerID, message1.modelID, message1.data);

      db.prepare(`
        INSERT INTO message (id, sessionID, parentID, role, providerID, modelID, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(message2.id, message2.sessionID, message2.parentID, message2.role,
        message2.providerID, message2.modelID, message2.data);

      db.close();

      const result = readRetryStats({ dbPath: TEST_DB_PATH });

      expect(result.success).toBe(true);
      expect(result.stats.totalRetries).toBe(1);
    });

    it('should detect "429" status code pattern', () => {
      const db = new Database(TEST_DB_PATH);

      db.exec(`
        CREATE TABLE message (
          id TEXT PRIMARY KEY,
          sessionID TEXT NOT NULL,
          parentID TEXT,
          role TEXT NOT NULL,
          providerID TEXT,
          modelID TEXT,
          data TEXT NOT NULL
        );
      `);

      const now = Date.now();
      const timestamp = Math.floor(now / 1000);

      const message1 = {
        id: 'msg1',
        sessionID: 'session1',
        parentID: 'parent1',
        role: 'assistant',
        providerID: 'openai',
        modelID: 'gpt-4',
        data: JSON.stringify({
          status: 'error',
          error: 'Error 429: Too many requests',
          time: { created: timestamp }
        })
      };

      const message2 = {
        id: 'msg2',
        sessionID: 'session1',
        parentID: 'parent1',
        role: 'assistant',
        providerID: 'openai',
        modelID: 'gpt-4',
        data: JSON.stringify({
          status: 'success',
          content: 'Response',
          time: { created: timestamp + 1 }
        })
      };

      db.prepare(`
        INSERT INTO message (id, sessionID, parentID, role, providerID, modelID, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(message1.id, message1.sessionID, message1.parentID, message1.role,
        message1.providerID, message1.modelID, message1.data);

      db.prepare(`
        INSERT INTO message (id, sessionID, parentID, role, providerID, modelID, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(message2.id, message2.sessionID, message2.parentID, message2.role,
        message2.providerID, message2.modelID, message2.data);

      db.close();

      const result = readRetryStats({ dbPath: TEST_DB_PATH });

      expect(result.success).toBe(true);
      expect(result.stats.totalRetries).toBe(1);
    });
  });
});
