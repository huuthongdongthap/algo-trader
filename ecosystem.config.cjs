// PM2 Ecosystem Configuration for Algo-Trade RaaS Platform
// Usage: pm2 start ecosystem.config.cjs --env production
module.exports = {
  apps: [
    {
      name: 'algo-trade',
      script: 'dist/app.js',
      cwd: __dirname,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
      },
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        API_PORT: '3000',
        DASHBOARD_PORT: '3001',
        WS_PORT: '3003',
        WEBHOOK_PORT: '3004',
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      min_uptime: '10s',
      // Graceful shutdown: SIGTERM → cancel orders → save state → exit
      kill_timeout: 15000,
      shutdown_with_message: true,
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'algo-dashboard',
      script: 'npx',
      args: 'serve dashboard/dist -s -l 3001',
      cwd: __dirname,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M',
      error_file: './logs/dashboard-error.log',
      out_file: './logs/dashboard-out.log',
      merge_logs: true,
    },
  ],
};
