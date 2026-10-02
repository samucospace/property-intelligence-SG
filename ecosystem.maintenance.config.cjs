// Dedicated maintenance scheduler configuration (Phase 1 / GL-03)
// Runs the persistent Singapore-timezone scheduler daemon with distributed SQLite locks.
// Decoupled from core web deployment.
// Command: pm2 start ecosystem.maintenance.config.cjs

module.exports = {
  apps: [
    {
      name: 'property-intelligence-scheduler',
      cwd: __dirname,
      script: './server/scheduler.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      watch: false,
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Singapore',
        DB_PATH: process.env.DB_PATH || '/app/data/property.db'
      }
    }
  ]
};
