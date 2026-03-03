import { buildRuntimeUrl, normalizeRuntimeHost } from "@/runtime-host";

describe("runtime host utilities", () => {
  it("normalizes plain host:port values", () => {
    expect(normalizeRuntimeHost("192.168.1.42:7842")).toBe("http://192.168.1.42:7842");
  });

  it("strips paths and query parameters from host input", () => {
    expect(normalizeRuntimeHost("http://192.168.1.42:7842/api?foo=bar")).toBe("http://192.168.1.42:7842");
  });

  it("returns null for non-http schemes", () => {
    expect(normalizeRuntimeHost("ftp://192.168.1.42:7842")).toBeNull();
  });

  it("builds API URLs from normalized runtime host", () => {
    expect(buildRuntimeUrl("192.168.1.42:7842", "/api/health")).toBe("http://192.168.1.42:7842/api/health");
  });
});
