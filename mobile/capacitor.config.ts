import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = { appId: 'com.thepropervolume.karaoke', appName: 'TPV Karaoke', webDir: '../dist/mobile',
  server: { androidScheme: 'https' }, ios: { contentInset: 'automatic' }, plugins: { CapacitorHttp: { enabled: false } } };
export default config;
