// PM2 Ecosystem Configuration for Algo-Trade RaaS Platform
module.exports = {
  apps: [
    {
      name: 'algo-trade',
      script: 'src/app.ts',
      interpreter: 'node_modules/.bin/tsx',
      cwd: '/Users/macbook/projects/algo-trader',
      exec_mode: 'fork',
      // Default env (development)
      env: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
        DB_PATH: './data/algo-trade.db',
      },
      // Production env overrides - activated via: pm2 start ecosystem.config.cjs --env production
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        DB_PATH: './data/algo-trade.db',
        PORT: '3000',
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
