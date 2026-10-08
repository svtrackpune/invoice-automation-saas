const config = {
  appId: 'in.nilanga.moneymatters',
  appName: 'Moneymatters FinOps',
  webDir: 'public',
  server: {
    url: process.env.CAPACITOR_SERVER_URL || 'https://mm.nilanga.in/next-workspace',
    cleartext: false,
  },
  loggingBehavior: 'none',
};

export default config;
