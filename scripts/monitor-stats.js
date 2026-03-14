#!/usr/bin/env bun

// Simple WebSocket monitor for Hydrabase stats
// Connects to running node and logs statistics

const fs = require('fs');
const WebSocket = require('ws');

const HYDRABASE_URL = 'ws://ddns.yazdani.au:4545';
const STATS_LOG = '/Users/stefanclaw/hydrabase/stats.json';

class HydrabaseMonitor {
  constructor() {
    this.dailyStats = this.loadDailyStats();
    this.lastReset = new Date().toDateString();
  }

  connect() {
    console.log(`🔌 Connecting to Hydrabase at ${HYDRABASE_URL}...`);
    
    // Add authentication headers for Hydrabase WebSocket
    const ws = new WebSocket(HYDRABASE_URL, {
      headers: {
        'User-Agent': 'HydrabaseMonitor/1.0',
        'x-api-key': 'monitor' // Use a generic API key for monitoring
      }
    });

    ws.on('open', () => {
      console.log('✅ Connected to Hydrabase WebSocket');
      
      // Send monitoring identification
      const monitorMessage = {
        clientType: 'stats-monitor',
        monitor: true,
        nonce: Date.now()
      };
      
      try {
        ws.send(JSON.stringify(monitorMessage));
        console.log('📤 Sent monitor identification');
      } catch (err) {
        console.log(`⚠️ Failed to send identification: ${err.message}`);
      }
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Look for stats messages
        if (message.stats) {
          this.processStats(message.stats);
        } else {
          console.log(`📨 Received message: ${Object.keys(message).join(', ')}`);
        }
      } catch (err) {
        console.log(`⚠️ Failed to parse message: ${err.message}`);
      }
    });

    ws.on('close', () => {
      console.log('📪 WebSocket connection closed, reconnecting in 5s...');
      setTimeout(() => this.connect(), 5000);
    });

    ws.on('error', (err) => {
      console.log(`❌ WebSocket error: ${err.message}`);
    });
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k**i).toFixed(1))  } ${  sizes[i]}`;
  }

  getDailyReport() {
    const stats = this.dailyStats;
    return {
      bandwidth: {
        peakPeers: stats.peakPeers,
        totalDownload: this.formatBytes(stats.totalDownload),
        totalUpload: this.formatBytes(stats.totalUpload)
      },
      date: stats.date,
      lastUpdate: new Date().toISOString(),
      samples: stats.samples.length
    };
  }

  loadDailyStats() {
    try {
      const data = fs.readFileSync(STATS_LOG, 'utf8');
      return JSON.parse(data);
    } catch {
      return {
        date: new Date().toDateString(),
        peakPeers: 0,
        samples: [],
        totalDownload: 0,
        totalQueries: 0,
        totalUpload: 0
      };
    }
  }

  processStats(stats) {
    this.resetIfNewDay();
    
    // Calculate current bandwidth from all peers
    let currentUpload = 0;
    let currentDownload = 0;
    let activePeers = 0;
    
    if (stats.peers && stats.peers.known) {
      stats.peers.known.forEach(peer => {
        if (peer.connection) {
          currentUpload += peer.connection.totalUL || 0;
          currentDownload += peer.connection.totalDL || 0;
          activePeers++;
        }
      });
    }

    // Update daily totals (track growth)
    this.dailyStats.totalUpload = Math.max(this.dailyStats.totalUpload, currentUpload);
    this.dailyStats.totalDownload = Math.max(this.dailyStats.totalDownload, currentDownload);
    this.dailyStats.peakPeers = Math.max(this.dailyStats.peakPeers, activePeers);
    
    // Store sample for hourly analysis
    this.dailyStats.samples.push({
      dhtNodes: stats.dhtNodes ? stats.dhtNodes.length : 0,
      download: currentDownload,
      peers: activePeers,
      timestamp: new Date().toISOString(),
      upload: currentUpload
    });

    // Keep only last 24 hours of samples
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    this.dailyStats.samples = this.dailyStats.samples.filter(
      sample => new Date(sample.timestamp) > oneDayAgo
    );

    this.saveDailyStats();
    
    console.log(`📊 Stats: ${this.formatBytes(currentUpload)} ↑, ${this.formatBytes(currentDownload)} ↓, ${activePeers} peers, ${stats.dhtNodes?.length || 0} DHT nodes`);
  }

  resetIfNewDay() {
    const today = new Date().toDateString();
    if (today !== this.lastReset) {
      console.log(`📅 New day detected, archiving previous stats for ${this.lastReset}`);
      // Archive previous day
      const archiveFile = `/Users/stefanclaw/hydrabase/stats-${this.lastReset.replace(/\s/g, '-')}.json`;
      fs.writeFileSync(archiveFile, JSON.stringify(this.dailyStats, null, 2));
      
      // Reset for new day
      this.dailyStats = {
        date: today,
        peakPeers: 0,
        samples: [],
        totalDownload: 0,
        totalQueries: 0,
        totalUpload: 0
      };
      this.lastReset = today;
    }
  }

  saveDailyStats() {
    fs.writeFileSync(STATS_LOG, JSON.stringify(this.dailyStats, null, 2));
  }
}

// Start monitoring
const monitor = new HydrabaseMonitor();

// Show daily report on startup
console.log('📊 Current daily report:', JSON.stringify(monitor.getDailyReport(), null, 2));

// Start WebSocket connection
monitor.connect();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n📊 Final daily report:');
  console.log(JSON.stringify(monitor.getDailyReport(), null, 2));
  process.exit(0);
});