/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx"],
  moduleNameMapper: {
    "^expo-router$": "<rootDir>/src/test-utils/expo-router-mock.tsx",
    "^react$": "<rootDir>/node_modules/react",
    "^react/jsx-runtime$": "<rootDir>/node_modules/react/jsx-runtime.js",
    "^react/jsx-dev-runtime$": "<rootDir>/node_modules/react/jsx-dev-runtime.js",
    "^react/package.json$": "<rootDir>/node_modules/react/package.json",
    "^react-test-renderer$": "<rootDir>/../../node_modules/react-test-renderer",
    "^react-test-renderer/package.json$": "<rootDir>/../../node_modules/react-test-renderer/package.json",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
