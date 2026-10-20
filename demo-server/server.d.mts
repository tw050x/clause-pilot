/** The demo server, started by the app in demo mode (see server.mjs). */
/** Answer almost at once (the demo's plans made in bulk) or at a model's pace again. */
export function setQuick(on: boolean): void
export function startDemoServer(options?: { port?: number; onLog?: (...args: unknown[]) => void }): Promise<{ existing: boolean; port: number; close: () => void }>
