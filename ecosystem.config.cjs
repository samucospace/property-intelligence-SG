module.exports = {
  apps: [
    {
      name: 'property-intelligence-sg',
      script: './server/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    }
  ]
};
