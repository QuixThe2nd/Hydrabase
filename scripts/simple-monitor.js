#!/usr/bin/env bun

// Simple HTTP polling monitor for Hydrabase
// Since WebSocket requires P2P authentication, use periodic checks

const fs = require('fs');

const STATS_LOG = '/Users/stefanclaw/hydrabase/stats.json';
const CHECK_INTERVAL = 30000; // 30 seconds

class SimpleMonitor {
  constructor() {
    this.dailyStats = this.loadDailyStats();
    this.lastCheck = new Date();
  }

  async checkNodeStatus() {
    this.resetIfNewDay();
    
    try {
      console.log('🔍 Checking node status...');
      
      // Check if node is responding
      const response = await fetch('http://localhost:4545/auth', {
        timeout: 5000
      });
      
      if (response.ok) {
        const auth = await response.json();
        
        this.dailyStats.checks++;
        this.dailyStats.nodeOnline = true;
        this.dailyStats.lastSeen = new Date().toISOString();
        
        // Calculate uptime for today
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const dayMinutes = (now - startOfDay) / 1000 / 60;
        
        if (this.lastCheck && this.dailyStats.nodeOnline) {
          const intervalMinutes = (now - this.lastCheck) / 1000 / 60;
          this.dailyStats.uptime += intervalMinutes;
        }
        
        // Get Docker network stats for bandwidth tracking
        try {
          const { execSync } = require('child_process');
          const dockerStats = execSync('docker stats hydrabase --no-stream --format "{{.NetIO}}"', { encoding: 'utf8' });
          const netIO = dockerStats.trim();
          const [netIn, netOut] = netIO.split(' / ');
          
          // Parse bandwidth (handle kB, MB, GB units)
          const parseBytes = (str) => {
            const match = str.match(/^([\d.]+)([kMG]?B)$/);
            if (!match) return 0;
            const num = parseFloat(match[1]);
            const unit = match[2];
            switch (unit) {
              case 'GB': return num * 1024 * 1024 * 1024;
              case 'kB': return num * 1024;
              case 'MB': return num * 1024 * 1024;
              default: return num;
            }
          };
          
          const bytesIn = parseBytes(netIn);
          const bytesOut = parseBytes(netOut);
          
          // Store current bandwidth totals
          this.dailyStats.totalDownload = bytesIn;
          this.dailyStats.totalUpload = bytesOut;
          
          // Track bandwidth growth (reset at midnight)
          if (!this.dailyStats.bandwidthGrowth) {
            this.dailyStats.bandwidthGrowth = { download: 0, upload: 0 };
          }
          
          console.log(`✅ Node online: ${auth.username || 'Unknown'} (${auth.address?.substring(0, 8)}...)`);
          console.log(`📊 Daily stats: ${this.dailyStats.checks} checks, ${Math.round(this.dailyStats.uptime)} min uptime`);
          console.log(`📡 Bandwidth: ↓${this.formatBytes(bytesIn)} ↑${this.formatBytes(bytesOut)}`);
          
        } catch (dockerErr) {
          console.log(`⚠️ Failed to get Docker stats: ${dockerErr.message}`);
        }
        
        this.lastCheck = now;
        
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
      
    } catch (err) {
      console.log(`❌ Node offline or unreachable: ${err.message}`);
      this.dailyStats.nodeOnline = false;
      this.lastCheck = new Date();
    }
    
    this.saveDailyStats();
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k**i).toFixed(1))  } ${  sizes[i]}`;
  }

  formatUptime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  }

  getDailyReport() {
    const stats = this.dailyStats;
    const uptimePercent = stats.uptime > 0 ? 
      Math.round((stats.uptime / (24 * 60)) * 100) : 0;

    // Calculate daily bandwidth usage
    const dailyDownload = (stats.totalDownload || 0) - (stats.bandwidthBaseline?.totalDownload || 0);
    const dailyUpload = (stats.totalUpload || 0) - (stats.bandwidthBaseline?.totalUpload || 0);

    // Get storage info
    let dbSize = 'Unknown', totalSize = 'Unknown';
    try {
      const fs = require('fs');
      const dbStats = fs.statSync('/Users/stefanclaw/hydrabase/repo/data/db.sqlite');
      dbSize = this.formatBytes(dbStats.size);
      
      const { execSync } = require('child_process');
      totalSize = execSync('du -sh /Users/stefanclaw/hydrabase/repo/data/', {encoding: 'utf8'}).split('\t')[0];
    } catch (e) {
      // Ignore errors
    }

    return `📊 **Hydrabase Daily Report - ${stats.date}**

🟢 **Node Status:**
• Currently: ${stats.nodeOnline ? 'Online ✅' : 'Offline ❌'}
• Identity: Anonymous (localhost:4545)
• Uptime today: ${this.formatUptime(stats.uptime)} (${uptimePercent}%)
• Health checks: ${stats.checks}
• Last seen: ${stats.lastSeen ? new Date(stats.lastSeen).toLocaleTimeString() : 'Never'}

📡 **Bandwidth (Docker network stats):**
• Total downloaded: ${this.formatBytes(stats.totalDownload || 0)}
• Total uploaded: ${this.formatBytes(stats.totalUpload || 0)}
• Daily downloaded: ${this.formatBytes(Math.max(0, dailyDownload))}
• Daily uploaded: ${this.formatBytes(Math.max(0, dailyUpload))}

💾 **Storage:**
• Database: ${dbSize}
• Total data: ${totalSize?.trim() || 'Unknown'}
• Container: hydrabase (Docker)

📈 **Network:**
• P2P endpoint: localhost:4545
• Monitoring since: ${new Date(stats.startTime).toLocaleDateString()}

Generated: ${new Date().toLocaleString()} Sydney time`;
  }

  loadDailyStats() {
    try {
      const data = fs.readFileSync(STATS_LOG, 'utf8');
      return JSON.parse(data);
    } catch {
      return {
        checks: 0,
        date: new Date().toDateString(),
        lastSeen: null,
        nodeOnline: false,
        startTime: new Date().toISOString(),
        uptime: 0
      };
    }
  }

  resetIfNewDay() {
    const today = new Date().toDateString();
    if (today !== this.dailyStats.date) {
      console.log(`📅 New day detected, archiving stats for ${this.dailyStats.date}`);
      
      // Archive previous day
      const archiveFile = `/Users/stefanclaw/hydrabase/stats-${this.dailyStats.date.replace(/\s/g, '-')}.json`;
      fs.writeFileSync(archiveFile, JSON.stringify(this.dailyStats, null, 2));
      
      // Reset for new day  
      const currentBandwidth = {
        totalDownload: this.dailyStats.totalDownload || 0,
        totalUpload: this.dailyStats.totalUpload || 0
      };
      
      this.dailyStats = {
        bandwidthBaseline: currentBandwidth,  // Track where we started today
        checks: 0,
        date: today,
        lastSeen: null,
        nodeOnline: false,
        startTime: new Date().toISOString(),
        totalDownload: 0,
        totalUpload: 0,
        uptime: 0
      };
    }
  }

  saveDailyStats() {
    fs.writeFileSync(STATS_LOG, JSON.stringify(this.dailyStats, null, 2));
  }

  async start() {
    console.log('🚀 Starting Hydrabase monitor...');
    console.log(`📊 Check interval: ${CHECK_INTERVAL / 1000}s`);
    
    // Initial check
    await this.checkNodeStatus();
    
    // Periodic checks
    setInterval(() => {
      this.checkNodeStatus().catch(err => {
        console.log(`💥 Monitor error: ${err.message}`);
      });
    }, CHECK_INTERVAL);
    
    console.log('✅ Monitor running - press Ctrl+C to stop');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  const monitor = new SimpleMonitor();
  console.log('\n📊 Final daily report:');
  console.log(monitor.getDailyReport());
  process.exit(0);
});

// Start monitoring if run directly
if (require.main === module) {
  const monitor = new SimpleMonitor();
  monitor.start().catch(err => {
    console.log(`💥 Failed to start monitor: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { SimpleMonitor };