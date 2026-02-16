/**
 * Tests for OpenCode database path resolution
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveOpenCodeDbPath, DEFAULT_OPENCODE_DB_PATH, LEGACY_OPENCODE_DB_PATH } from '../../src/config/defaults.js';
import { existsSync } from 'fs';
import type { PathLike } from 'fs';

// Mock fs.existsSync
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

describe('resolveOpenCodeDbPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Auto-Detection Logic', () => {
    it('should return primary path when database exists at DEFAULT_OPENCODE_DB_PATH', () => {
      vi.mocked(existsSync).mockImplementation((path: PathLike) => {
        return String(path) === DEFAULT_OPENCODE_DB_PATH;
      });

      const result = resolveOpenCodeDbPath();

      expect(result).toBe(DEFAULT_OPENCODE_DB_PATH);
      expect(existsSync).toHaveBeenCalledWith(DEFAULT_OPENCODE_DB_PATH);
      expect(existsSync).not.toHaveBeenCalledWith(LEGACY_OPENCODE_DB_PATH);
    });

    it('should return fallback path when primary does not exist but legacy does', () => {
      vi.mocked(existsSync).mockImplementation((path: PathLike) => {
        return String(path) === LEGACY_OPENCODE_DB_PATH;
      });

      const result = resolveOpenCodeDbPath();

      expect(result).toBe(LEGACY_OPENCODE_DB_PATH);
      expect(existsSync).toHaveBeenCalledWith(DEFAULT_OPENCODE_DB_PATH);
      expect(existsSync).toHaveBeenCalledWith(LEGACY_OPENCODE_DB_PATH);
    });

    it('should return undefined when neither primary nor legacy path exists', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = resolveOpenCodeDbPath();

      expect(result).toBeUndefined();
      expect(existsSync).toHaveBeenCalledWith(DEFAULT_OPENCODE_DB_PATH);
      expect(existsSync).toHaveBeenCalledWith(LEGACY_OPENCODE_DB_PATH);
    });
  });

  describe('Custom Path Support', () => {
    it('should return custom path when it exists', () => {
      const customPath = '/custom/path/opencode.db';
      vi.mocked(existsSync).mockReturnValue(true);

      const result = resolveOpenCodeDbPath(customPath);

      expect(result).toBe(customPath);
      expect(existsSync).toHaveBeenCalledWith(customPath);
      expect(existsSync).not.toHaveBeenCalledWith(DEFAULT_OPENCODE_DB_PATH);
    });

    it('should fall back to primary path when custom path does not exist', () => {
      const customPath = '/nonexistent/path/opencode.db';
      vi.mocked(existsSync).mockImplementation((path: PathLike) => {
        return String(path) === DEFAULT_OPENCODE_DB_PATH;
      });

      const result = resolveOpenCodeDbPath(customPath);

      expect(result).toBe(DEFAULT_OPENCODE_DB_PATH);
      expect(existsSync).toHaveBeenCalledWith(customPath);
      expect(existsSync).toHaveBeenCalledWith(DEFAULT_OPENCODE_DB_PATH);
    });

    it('should fall back to legacy path when custom and primary do not exist', () => {
      const customPath = '/nonexistent/path/opencode.db';
      vi.mocked(existsSync).mockImplementation((path: PathLike) => {
        return String(path) === LEGACY_OPENCODE_DB_PATH;
      });

      const result = resolveOpenCodeDbPath(customPath);

      expect(result).toBe(LEGACY_OPENCODE_DB_PATH);
      expect(existsSync).toHaveBeenCalledWith(customPath);
      expect(existsSync).toHaveBeenCalledWith(DEFAULT_OPENCODE_DB_PATH);
      expect(existsSync).toHaveBeenCalledWith(LEGACY_OPENCODE_DB_PATH);
    });

    it('should return undefined when none of the paths exist', () => {
      const customPath = '/nonexistent/path/opencode.db';
      vi.mocked(existsSync).mockReturnValue(false);

      const result = resolveOpenCodeDbPath(customPath);

      expect(result).toBeUndefined();
      expect(existsSync).toHaveBeenCalledWith(customPath);
      expect(existsSync).toHaveBeenCalledWith(DEFAULT_OPENCODE_DB_PATH);
      expect(existsSync).toHaveBeenCalledWith(LEGACY_OPENCODE_DB_PATH);
    });
  });

  describe('Priority Order', () => {
    it('should prioritize custom path over defaults when custom exists', () => {
      const customPath = '/custom/path/opencode.db';
      vi.mocked(existsSync).mockReturnValue(true);

      const result = resolveOpenCodeDbPath(customPath);

      expect(result).toBe(customPath);
      expect(existsSync).toHaveBeenCalledTimes(1);
      expect(existsSync).toHaveBeenCalledWith(customPath);
    });

    it('should prioritize primary path over legacy when custom is not provided', () => {
      vi.mocked(existsSync).mockImplementation((path: PathLike) => {
        return String(path) === DEFAULT_OPENCODE_DB_PATH || String(path) === LEGACY_OPENCODE_DB_PATH;
      });

      const result = resolveOpenCodeDbPath();

      expect(result).toBe(DEFAULT_OPENCODE_DB_PATH);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string custom path as undefined', () => {
      vi.mocked(existsSync).mockImplementation((path: PathLike) => {
        return String(path) === DEFAULT_OPENCODE_DB_PATH;
      });

      const result = resolveOpenCodeDbPath('');

      expect(result).toBe(DEFAULT_OPENCODE_DB_PATH);
    });

    it('should handle undefined custom path as no custom path', () => {
      vi.mocked(existsSync).mockImplementation((path: PathLike) => {
        return String(path) === DEFAULT_OPENCODE_DB_PATH;
      });

      const result = resolveOpenCodeDbPath(undefined);

      expect(result).toBe(DEFAULT_OPENCODE_DB_PATH);
    });
  });
});
