module.exports = {
  apps: [
    // 1. Primary Unified Web App Server
    {
      name: 'property-intelligence-sg',
      cwd: __dirname,
      script: './server/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        TZ: 'Asia/Singapore'
      }
    },

    // 2. Weekly Market Digest Newsletter (Every Monday at 08:00 SGT)
    {
      name: 'cron-weekly-newsletter',
      cwd: __dirname,
      script: './server/scripts/send-weekly-newsletter.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: false,
      cron_restart: '0 8 * * 1',
      watch: false,
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Singapore'
      }
    },

    // 3. Weekly URA Data Service Caveat & Rental Sync (Every Sunday at 02:00 SGT)
    {
      name: 'cron-ura-sync',
      cwd: __dirname,
      script: './server/scripts/sync-ura.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: false,
      cron_restart: '0 2 * * 0',
      watch: false,
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Singapore'
      }
    },

    // 4. Monthly PDPA Lead Retention Cleanup (1st of every month at 03:00 SGT)
    {
      name: 'cron-leads-cleanup',
      cwd: __dirname,
      script: './server/scripts/cleanup-leads.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: false,
      cron_restart: '0 3 1 * *',
      watch: false,
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Singapore'
      }
    },

    // 5. Daily SQLite Online Database Backup (Daily at 04:00 SGT)
    {
      name: 'cron-db-backup',
      cwd: __dirname,
      script: './server/scripts/backup-db.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: false,
      cron_restart: '0 4 * * *',
      watch: false,
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Singapore'
      }
    }
  ]
};
