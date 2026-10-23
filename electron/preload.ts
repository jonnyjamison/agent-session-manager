import { contextBridge, ipcRenderer } from 'electron';
import type { CheckpointRequest, ContextState, Session, TerminalEvent } from './types';
contextBridge.exposeInMainWorld('sessions', {
  workspace: () => ipcRenderer.invoke('workspace:get'),
  clis: () => ipcRenderer.invoke('clis:get'),
  external: () => ipcRenderer.invoke('external:scan'),
  context: () => ipcRenderer.invoke('context:get'),
  rememberSource: (id: string) => ipcRenderer.invoke('context:remember-source', id),
  copyHandoverPrompt: () => ipcRenderer.invoke('context:handover-prompt'),
  flag: (sourceId: string, reason: string) => ipcRenderer.invoke('attention:flag', { sourceId, reason }),
  resolveAttention: (id: string) => ipcRenderer.invoke('attention:resolve', id),
  notifications: (enabled: boolean) => ipcRenderer.invoke('context:notifications', enabled),
  saveCheckpoint: (request: CheckpointRequest) => ipcRenderer.invoke('checkpoint:save', request),
  copyCheckpoint: (id: string) => ipcRenderer.invoke('checkpoint:copy', id),
  exportCheckpoint: (id: string, format: 'markdown' | 'json') => ipcRenderer.invoke('checkpoint:export', { id, format }),
  importCheckpoint: () => ipcRenderer.invoke('checkpoint:import'),
  onContext: (callback: (state: ContextState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: ContextState) => callback(value);
    ipcRenderer.on('context:changed', listener);
    return () => ipcRenderer.removeListener('context:changed', listener);
  },
  onAttentionOpen: (callback: () => void) => {
    const listener = () => callback(); ipcRenderer.on('attention:open', listener);
    return () => ipcRenderer.removeListener('attention:open', listener);
  },
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  create: (provider: string, name: string, cwd: string) => ipcRenderer.invoke('session:create', { provider, name, cwd }),
  restart: (id: string) => ipcRenderer.invoke('session:restart', id),
  stop: (id: string) => ipcRenderer.invoke('session:stop', id),
  remove: (id: string) => ipcRenderer.invoke('session:remove', id),
  rename: (id: string, name: string) => ipcRenderer.invoke('session:rename', { id, name }),
  select: (id: string) => ipcRenderer.invoke('session:select', id),
  snapshot: (id: string) => ipcRenderer.invoke('terminal:snapshot', id),
  input: (id: string, data: string) => ipcRenderer.send('terminal:input', { id, data }),
  resize: (id: string, cols: number, rows: number) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
  onData: (callback: (event: TerminalEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: TerminalEvent) => callback(value);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  onSession: (callback: (session: Session) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: Session) => callback(value);
    ipcRenderer.on('session:changed', listener);
    return () => ipcRenderer.removeListener('session:changed', listener);
  }
});
