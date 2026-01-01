import { K8sWatcher } from './k8s-watcher';
import { registerMetadata } from './register-metadata';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://painchain-app:8000/api';

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║ PainChain Kubernetes Connector v1.0.0 ║');
  console.log('╚════════════════════════════════════════╝');
  console.log();
  console.log(`Backend API: ${BACKEND_API_URL}`);
  console.log();

  // Register connector metadata with backend
  console.log('Registering connector metadata...');
  await registerMetadata(BACKEND_API_URL);
  console.log();

  // Start watcher
  const watcher = new K8sWatcher(BACKEND_API_URL);
  await watcher.start();
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
