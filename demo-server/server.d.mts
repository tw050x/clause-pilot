/** The demo server, started by the app in demo mode (see server.mjs). */
export function startDemoServer(options?: { port?: number; onLog?: (...args: unknown[]) => void }): Promise<{ existing: boolean; port: number; close: () => void }>
