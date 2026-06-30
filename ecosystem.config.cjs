module.exports = {
  apps: [
    {
      name: "recording-summary",
      script: "npm",
      args: "run start",
      cwd: "/opt/recording-summary",
      env: {
        NODE_ENV: "production"
      },
      max_memory_restart: "700M"
    }
  ]
};
