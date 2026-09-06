'use strict';
/**
 * WaWi Debug & Telemetrie-Engine
 * Bietet kontinuierliches Logging, Ringpuffer-Speicherung für Live-Debugging,
 * Performance-Tracing und Dateirotation — 100% ohne externe Abhängigkeiten.
 */

const fs = require('fs');
const path = require('path');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  PERF: 2,
  WARN: 3,
  ERROR: 4,
  AUDIT: 5,
};

class DebugLogger {
  constructor(options = {}) {
    this.logDir = options.logDir || path.join(__dirname, '../data/logs');
    this.bufferSize = options.bufferSize || 500;
    this.ringBuffer = [];
    this.minLevel = LOG_LEVELS[options.minLevel || 'DEBUG'];
    this.activeTimers = new Map();
    this.ensureLogDir();
  }

  ensureLogDir() {
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
    } catch (err) {
      console.error('[Logger] Konnte Log-Verzeichnis nicht erstellen:', err.message);
    }
  }

  formatTimestamp(date = new Date()) {
    return date.toISOString();
  }

  log(level, category, message, meta = {}) {
    const numericLevel = LOG_LEVELS[level] !== undefined ? LOG_LEVELS[level] : LOG_LEVELS.INFO;
    if (numericLevel < this.minLevel) return;

    const entry = {
      timestamp: this.formatTimestamp(),
      level,
      category,
      message,
      meta,
    };

    // 1. In-Memory Ringpuffer für Live-Admin-Konsole
    this.ringBuffer.push(entry);
    if (this.ringBuffer.length > this.bufferSize) {
      this.ringBuffer.shift();
    }

    // 2. Standard Output
    const metaStr = Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
    const formatted = `[${entry.timestamp}] [${level.padEnd(5)}] [${category}] ${message}${metaStr}`;
    
    if (level === 'ERROR') {
      console.error(formatted);
    } else if (level === 'WARN') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }

    // 3. Persistentes Logfile mit Datumsstempel
    this.writeToFile(formatted);
  }

  debug(category, message, meta) { this.log('DEBUG', category, message, meta); }
  info(category, message, meta) { this.log('INFO', category, message, meta); }
  warn(category, message, meta) { this.log('WARN', category, message, meta); }
  error(category, message, meta) { this.log('ERROR', category, message, meta); }
  audit(category, message, meta) { this.log('AUDIT', category, message, meta); }
  perf(category, message, meta) { this.log('PERF', category, message, meta); }

  time(label) {
    this.activeTimers.set(label, process.hrtime.bigint());
  }

  timeEnd(label, category = 'PERF', meta = {}) {
    const start = this.activeTimers.get(label);
    if (!start) return;
    const end = process.hrtime.bigint();
    this.activeTimers.delete(label);
    const durationMs = Number(end - start) / 1_000_000;
    this.perf(category, `${label} abgeschlossen in ${durationMs.toFixed(2)}ms`, {
      ...meta,
      durationMs: Number(durationMs.toFixed(2)),
    });
    return durationMs;
  }

  writeToFile(line) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const filePath = path.join(this.logDir, `wawi-${today}.log`);
      fs.appendFileSync(filePath, line + '\n', 'utf8');
    } catch {
      // Stiller Fehler falls Dateisystem blockiert
    }
  }

  getRecentLogs(limit = 100, filterLevel = null, filterCategory = null) {
    let list = [...this.ringBuffer];
    if (filterLevel) {
      list = list.filter(e => e.level === filterLevel);
    }
    if (filterCategory) {
      list = list.filter(e => e.category.toLowerCase().includes(filterCategory.toLowerCase()));
    }
    return list.slice(-limit);
  }

  getSystemMetrics() {
    const memory = process.memoryUsage();
    return {
      uptimeSec: Math.floor(process.uptime()),
      memory: {
        rssMb: Number((memory.rss / 1024 / 1024).toFixed(2)),
        heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(2)),
        heapTotalMb: Number((memory.heapTotal / 1024 / 1024).toFixed(2)),
      },
      bufferCount: this.ringBuffer.length,
      activeTimers: this.activeTimers.size,
    };
  }
}

// Singleton-Instanz für globale Wiederverwendung
const logger = new DebugLogger();

module.exports = { DebugLogger, logger };
