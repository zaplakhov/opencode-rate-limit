/**
 * Command Installer - Automatically installs slash-commands for OpenCode
 */

import type { Logger } from '../../logger.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const COMMAND_NAME = 'rate-limit-status';
const COMMAND_FILE = 'rate-limit-status.md';
const COMMAND_DIR = path.join(os.homedir(), '.config', 'opencode', 'commands');

/**
 * Command content for the slash-command
 */
const COMMAND_CONTENT = `---
description: Показать статистику rate limits, здоровье моделей и прогноз до следующей блокировки
---

Используй инструмент rate-limit-status для отображения:
- Текущий статус здоровья моделей (health score)
- Статистику rate limits для каждой модели
- Статистику fallbacks (переключений между моделями)
- Статистику ретраев (повторных попыток)
- Прогноз до следующей возможной блокировки по rate limit

Инструмент вернёт форматированный Markdown отчёт со всей информацией.
`;

/**
 * CommandInstaller class - handles slash-command installation
 */
export class CommandInstaller {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Install the slash-command file
   */
  async install(): Promise<{ success: boolean; path?: string; error?: string }> {
    const commandPath = path.join(COMMAND_DIR, COMMAND_FILE);

    try {
      // Check if command already exists
      if (fs.existsSync(commandPath)) {
        this.logger.info(`Slash-command already exists: ${commandPath}`);
        return { success: true, path: commandPath };
      }

      // Ensure commands directory exists
      await fs.promises.mkdir(COMMAND_DIR, { recursive: true });

      // Write the command file
      await fs.promises.writeFile(commandPath, COMMAND_CONTENT, 'utf8');

      this.logger.info(`Slash-command installed successfully: ${commandPath}`);
      this.logger.info(`You can now use /${COMMAND_NAME} in OpenCode TUI`);

      return { success: true, path: commandPath };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to install slash-command: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Check if the command is installed
   */
  isInstalled(): boolean {
    const commandPath = path.join(COMMAND_DIR, COMMAND_FILE);
    return fs.existsSync(commandPath);
  }

  /**
   * Get the command file path
   */
  getCommandPath(): string {
    return path.join(COMMAND_DIR, COMMAND_FILE);
  }

  /**
   * Uninstall the slash-command file
   */
  async uninstall(): Promise<{ success: boolean; error?: string }> {
    const commandPath = path.join(COMMAND_DIR, COMMAND_FILE);

    try {
      if (!fs.existsSync(commandPath)) {
        this.logger.info('Slash-command not found, nothing to uninstall');
        return { success: true };
      }

      await fs.promises.unlink(commandPath);
      this.logger.info(`Slash-command removed: ${commandPath}`);

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to uninstall slash-command: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }
}
