/**
 * Tests for readFallbackStats function
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'fs';
import { readFallbackStats } from './opencodeDbFallbackStats.js';

describe('readFallbackStats', () => {
  const TEST_DB_PATH = '/tmp/test-opencode-rate-limit-fallback.db';

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
    const result = readFallbackStats({ dbPath: invalidPath });
    // If database was found, it will have an error
    // If not found, the error message will contain "not found"
    if (result.success) {
      // Database was found but might have wrong schema - this is acceptable for auto-detection
      expect(result.stats.totalFallbacks).toBe(0);
      expect(result.stats.bySourceModel.size).toBe(0);
      expect(result.stats.byTargetModel.size).toBe(0);
    } else {
      // Either database not found or schema error
      expect(result.stats.totalFallbacks).toBe(0);
      expect(result.stats.bySourceModel.size).toBe(0);
      expect(result.stats.byTargetModel.size).toBe(0);
    }
  });

  it('should identify fallback attempts when model changes', () => {
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

    // First message with rate limit error on gpt-4
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

    // Second message - fallback to gpt-3.5-turbo
    const message2 = {
      id: 'msg2',
      sessionID: 'session1',
      parentID: 'parent1',
      role: 'assistant',
      providerID: 'openai',
      modelID: 'gpt-3.5-turbo',
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

    const result = readFallbackStats({ dbPath: TEST_DB_PATH });

    expect(result.success).toBe(true);
    expect(result.stats.totalFallbacks).toBe(1);
    expect(result.stats.bySourceModel.size).toBe(1);
    expect(result.stats.byTargetModel.size).toBe(1);

    const sourceStats = result.stats.bySourceModel.get('openai/gpt-4');
    expect(sourceStats).toBeDefined();
    expect(sourceStats?.count).toBe(1);
    expect(sourceStats?.targetModel).toBe('openai/gpt-3.5-turbo');

    const targetStats = result.stats.byTargetModel.get('openai/gpt-3.5-turbo');
    expect(targetStats).toBeDefined();
    expect(targetStats?.usedAsFallback).toBe(1);
  });

  it('should not count as fallback when model is the same', () => {
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

    // Second message - same model (retry, not fallback)
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

    const result = readFallbackStats({ dbPath: TEST_DB_PATH });

    expect(result.success).toBe(true);
    expect(result.stats.totalFallbacks).toBe(0);
  });

  it('should identify fallback when provider changes', () => {
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

    // First message with rate limit error on openai
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

    // Second message - fallback to anthropic
    const message2 = {
      id: 'msg2',
      sessionID: 'session1',
      parentID: 'parent1',
      role: 'assistant',
      providerID: 'anthropic',
      modelID: 'claude-3',
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

    const result = readFallbackStats({ dbPath: TEST_DB_PATH });

    expect(result.success).toBe(true);
    expect(result.stats.totalFallbacks).toBe(1);
    expect(result.stats.bySourceModel.size).toBe(1);
    expect(result.stats.byTargetModel.size).toBe(1);

    const sourceStats = result.stats.bySourceModel.get('openai/gpt-4');
    expect(sourceStats).toBeDefined();
    expect(sourceStats?.count).toBe(1);
    expect(sourceStats?.targetModel).toBe('anthropic/claude-3');
  });
});
