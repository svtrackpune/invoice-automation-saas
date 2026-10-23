const config = {
  appId: 'in.nilanga.moneymatters',
  appName: 'Moneymatters FinOps',
  webDir: 'public',
  server: {
    url: process.env.CAPACITOR_SERVER_URL || 'https://mm.nilanga.in/mobile?app=android',
    cleartext: false,
  },
  loggingBehavior: 'none',
};

export default config;
