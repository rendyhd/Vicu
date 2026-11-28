/** The part of Electron's IpcMainInvokeEvent a portable handler may read. */
export interface HandlerEvent { sender: { id: number } }
/** Registers one channel. The desktop passes `handleTrusted`, the web host its own registry. */
export type Handle = (channel: string, listener: (event: HandlerEvent, ...args: any[]) => unknown) => void
