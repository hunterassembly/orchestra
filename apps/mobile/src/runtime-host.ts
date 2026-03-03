function withHttpProtocol(value: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }

  return `http://${value}`;
}

export function normalizeRuntimeHost(rawHost: string | null | undefined): string | null {
  if (typeof rawHost !== "string") {
    return null;
  }

  const trimmed = rawHost.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const url = new URL(withHttpProtocol(trimmed));
    const protocol = url.protocol.toLowerCase();

    if (protocol !== "http:" && protocol !== "https:") {
      return null;
    }

    if (!url.hostname) {
      return null;
    }

    return `${protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function buildRuntimeUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const normalizedBase = normalizeRuntimeHost(baseUrl);

  if (normalizedBase) {
    return new URL(normalizedPath, `${normalizedBase}/`).toString();
  }

  const trimmedBase = baseUrl.trim().replace(/\/+$/, "");
  return `${trimmedBase}${normalizedPath}`;
}
