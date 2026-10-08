const config = {
  appId: 'in.moneymatters.app',
  appName: 'Moneymatters',
  webDir: 'public',
  server: {
    url: process.env.CAPACITOR_SERVER_URL || 'https://mm.nilanga.in',
    cleartext: false,
  },
  loggingBehavior: 'none',
};

export default config;
