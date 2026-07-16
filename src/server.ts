import app from './app';
import { env } from './config/env';

const server = app.listen(env.PORT, () => {
  console.log(`\n🚀 Vouch API running on http://localhost:${env.PORT}`);
  console.log(`   Environment: ${env.NODE_ENV}`);
  console.log(`   Health:      http://localhost:${env.PORT}/health`);
  console.log(`   DB Admin:    http://localhost:8080  (Adminer)\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down gracefully');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received — shutting down');
  server.close(() => process.exit(0));
});

export default server;
