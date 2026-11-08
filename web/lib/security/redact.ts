export function redactServerText(value: string): string {
  return value
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/nvapi-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/apikey=[^&\s]+/gi, "apikey=[redacted]");
}
