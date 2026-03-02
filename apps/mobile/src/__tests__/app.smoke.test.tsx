import { render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

import RootLayout from "@/app/_layout";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockedGetItemAsync = jest.mocked(SecureStore.getItemAsync);

describe("Root layout routing", () => {
  beforeEach(() => {
    mockedGetItemAsync.mockReset();
  });

  it("shows onboarding routes when no token exists", async () => {
    mockedGetItemAsync.mockResolvedValue(null);

    render(<RootLayout />);

    await waitFor(() => {
      expect(screen.getByText("(onboarding)")).toBeTruthy();
    });

    expect(screen.queryByText("(main)")).toBeNull();
  });

  it("shows main routes when token exists", async () => {
    mockedGetItemAsync.mockResolvedValue("token-123");

    render(<RootLayout />);

    await waitFor(() => {
      expect(screen.getByText("(main)")).toBeTruthy();
    });

    expect(screen.queryByText("(onboarding)")).toBeNull();
  });
});
