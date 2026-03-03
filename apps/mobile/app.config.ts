export default {
  expo: {
    name: "Orchestra",
    slug: "orchestra-mobile",
    owner: "hunter2d",
    version: "0.1.0",
    scheme: "orchestra",
    newArchEnabled: true,
    plugins: ["expo-router", "expo-secure-store", "expo-dev-client"],
    ios: {
      bundleIdentifier: "com.hunter2d.orchestra.mobile",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    runtimeVersion: "0.1.0",
    updates: {
      url: "https://u.expo.dev/b9368ed7-ed09-497c-8488-811cc225e3d2",
    },
    experiments: {
      typedRoutes: true,
    },
    extra: {
      eas: {
        projectId: "b9368ed7-ed09-497c-8488-811cc225e3d2",
      },
    },
  },
};
