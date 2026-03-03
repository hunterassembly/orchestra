import type { CredentialRequestDTO } from "@craft-agent/mobile-contracts";

import {
  buildCredentialResponse,
  createCredentialFormValues,
  credentialMode,
  deriveFileName,
  formatBytes,
  guessMimeType,
  isCancelledError,
} from "@/features/session/parity-utils";

describe("session parity utils", () => {
  it("formats byte sizes for B/KB/MB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1_536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("derives file names from URI and decodes encoded names", () => {
    expect(deriveFileName("file:///tmp/report.pdf")).toBe("report.pdf");
    expect(deriveFileName("file:///tmp/My%20Report.pdf")).toBe("My Report.pdf");
  });

  it("guesses MIME type from extension when fallback is empty", () => {
    expect(guessMimeType("image.png", "")).toBe("image/png");
    expect(guessMimeType("manual.PDF", "")).toBe("application/pdf");
    expect(guessMimeType("unknown.foo", "")).toBe("application/octet-stream");
    expect(guessMimeType("doc.txt", "text/custom")).toBe("text/custom");
  });

  it("detects cancellation errors", () => {
    expect(isCancelledError(new Error("User cancelled picker"))).toBe(true);
    expect(isCancelledError(new Error("network timeout"))).toBe(false);
    expect(isCancelledError("cancelled")).toBe(false);
  });

  it("builds default credential form values and mode", () => {
    const request: CredentialRequestDTO = {
      requestId: "cred-1",
      headerName: "Authorization",
    };

    expect(credentialMode(request)).toBe("bearer");
    expect(createCredentialFormValues(request)).toEqual({
      value: "",
      username: "",
      password: "",
      headers: {
        Authorization: "",
      },
    });
  });

  it("buildCredentialResponse validates basic auth", () => {
    const request: CredentialRequestDTO = {
      requestId: "cred-2",
      inputMode: "basic",
      passwordRequired: true,
    };

    const invalid = buildCredentialResponse(request, {
      value: "",
      username: " ",
      password: "",
      headers: {},
    });
    expect(invalid.response).toBeNull();
    expect(invalid.error).toBe("Username and password are required.");

    const valid = buildCredentialResponse(request, {
      value: "",
      username: "alice",
      password: "secret",
      headers: {},
    });
    expect(valid.error).toBeNull();
    expect(valid.response).toEqual({
      type: "credential",
      username: "alice",
      password: "secret",
      cancelled: false,
    });
  });

  it("buildCredentialResponse validates multi-header auth", () => {
    const request: CredentialRequestDTO = {
      requestId: "cred-3",
      inputMode: "multi-header",
    };

    const invalid = buildCredentialResponse(request, {
      value: "",
      username: "",
      password: "",
      headers: {
        "DD-API-KEY": " ",
      },
    });
    expect(invalid.response).toBeNull();
    expect(invalid.error).toBe("Enter at least one credential header value.");

    const valid = buildCredentialResponse(request, {
      value: "",
      username: "",
      password: "",
      headers: {
        "DD-API-KEY": "abc",
        "DD-APPLICATION-KEY": " def ",
      },
    });
    expect(valid.error).toBeNull();
    expect(valid.response).toEqual({
      type: "credential",
      headers: {
        "DD-API-KEY": "abc",
        "DD-APPLICATION-KEY": "def",
      },
      cancelled: false,
    });
  });

  it("buildCredentialResponse validates bearer/header/query value modes", () => {
    const request: CredentialRequestDTO = {
      requestId: "cred-4",
      inputMode: "bearer",
    };

    const invalid = buildCredentialResponse(request, {
      value: " ",
      username: "",
      password: "",
      headers: {},
    });
    expect(invalid.response).toBeNull();
    expect(invalid.error).toBe("Credential value is required.");

    const valid = buildCredentialResponse(request, {
      value: " token ",
      username: "",
      password: "",
      headers: {},
    });
    expect(valid.error).toBeNull();
    expect(valid.response).toEqual({
      type: "credential",
      value: "token",
      cancelled: false,
    });
  });
});
