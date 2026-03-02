import type { PropsWithChildren } from "react";

jest.mock("react-native-safe-area-context", () => {
  return {
    SafeAreaProvider: ({ children }: PropsWithChildren) => children,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});
