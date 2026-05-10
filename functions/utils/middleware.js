export async function errorHandling(context) {
  return context.next();
}

export function telemetryData(context) {
  return context.next();
}

export async function traceData() {
}
