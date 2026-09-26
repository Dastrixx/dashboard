module.exports = {
  apps: [{
    name: 'dashboard-sync-worker',
    script: 'server/sync/worker.mjs',
    interpreter: 'node',
    node_args: '--env-file-if-exists=.env',
    instances: 1,
    exec_mode: 'fork',
    restart_delay: 5000,
  }],
};
