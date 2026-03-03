import type {
  CredentialInputModeDTO,
  CredentialRequestDTO,
  CredentialResponseDTO,
} from "@craft-agent/mobile-contracts";

export type CredentialFormValues = {
  value: string;
  username: string;
  password: string;
  headers: Record<string, string>;
};

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function deriveFileName(uri: string): string {
  const candidate = uri.split("/").pop() ?? "";
  if (!candidate) {
    return `attachment-${Date.now()}`;
  }

  try {
    return decodeURIComponent(candidate);
  } catch {
    return candidate;
  }
}

export function guessMimeType(name: string, fallback: string): string {
  if (fallback.trim().length > 0) {
    return fallback;
  }

  const normalized = name.trim().toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".pdf")) return "application/pdf";
  if (normalized.endsWith(".md")) return "text/markdown";
  if (normalized.endsWith(".json")) return "application/json";
  if (normalized.endsWith(".txt")) return "text/plain";

  return "application/octet-stream";
}

export function isCancelledError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const normalized = error.message.toLowerCase();
  return normalized.includes("cancel");
}

export function credentialMode(request: CredentialRequestDTO): CredentialInputModeDTO {
  return request.inputMode ?? "bearer";
}

export function createCredentialFormValues(request: CredentialRequestDTO): CredentialFormValues {
  const headers: Record<string, string> = {};

  const explicitHeaders = request.headerNames ?? [];
  for (const header of explicitHeaders) {
    if (header.trim().length > 0) {
      headers[header] = "";
    }
  }

  if (request.headerName && request.headerName.trim().length > 0 && !(request.headerName in headers)) {
    headers[request.headerName] = "";
  }

  return {
    value: "",
    username: "",
    password: "",
    headers,
  };
}

export function buildCredentialResponse(
  request: CredentialRequestDTO,
  formValues: CredentialFormValues,
): { response: CredentialResponseDTO | null; error: string | null } {
  const mode = credentialMode(request);

  if (mode === "basic") {
    const username = formValues.username.trim();
    const password = formValues.password.trim();
    if (username.length === 0 || (request.passwordRequired !== false && password.length === 0)) {
      return {
        response: null,
        error: "Username and password are required.",
      };
    }

    return {
      response: {
        type: "credential",
        username,
        password,
        cancelled: false,
      },
      error: null,
    };
  }

  if (mode === "multi-header") {
    const headers = Object.entries(formValues.headers).reduce<Record<string, string>>((acc, [key, value]) => {
      const nextValue = value.trim();
      if (nextValue.length > 0) {
        acc[key] = nextValue;
      }
      return acc;
    }, {});

    if (Object.keys(headers).length === 0) {
      return {
        response: null,
        error: "Enter at least one credential header value.",
      };
    }

    return {
      response: {
        type: "credential",
        headers,
        cancelled: false,
      },
      error: null,
    };
  }

  const value = formValues.value.trim();
  if (value.length === 0) {
    return {
      response: null,
      error: "Credential value is required.",
    };
  }

  return {
    response: {
      type: "credential",
      value,
      cancelled: false,
    },
    error: null,
  };
}
