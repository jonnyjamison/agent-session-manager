export type Provider = 'claude' | 'codex';
export type Status = 'running' | 'stopped' | 'error';
export interface Session { id: string; name: string; provider: Provider; cwd: string; status: Status; createdAt: string; exitCode?: number; error?: string }
export interface Workspace { sessions: Session[]; activeId: string | null }
export interface TerminalEvent { id: string; data: string; sequence: number }
export interface CliInfo { claude: string | null; codex: string | null }
export interface ExternalSession { id: string; pid: number; provider: Provider; name: string; status: 'running' | 'stopped'; startedAt: string | null; projectFolder: string | null }
export interface ExternalSnapshot { sessions: ExternalSession[]; checkedAt: string | null; error: string | null }

export interface ContextSource { id: string; kind: 'managed' | 'external'; provider: Provider; name: string; cwd: string | null }
export type AttentionOrigin = 'manual' | 'inferred' | 'terminal-notification' | 'process-exit';
export interface AttentionItem { id: string; source: ContextSource; reason: string; origin: AttentionOrigin; createdAt: string; resolvedAt: string | null }
export interface CheckpointFields { title: string; goal: string; progress: string; decisions: string; blockers: string; nextSteps: string; references: string; verification: string }
export interface GitContext { branch: string; commit: string; status: string; capturedAt: string; error: string | null }
export interface Checkpoint extends CheckpointFields { id: string; source: ContextSource; createdAt: string; parentId: string | null; git: GitContext | null; terminalExcerpt: string | null }
export interface ContextState { version: 1; attention: AttentionItem[]; checkpoints: Checkpoint[]; sources: ContextSource[]; notifications: boolean }
export interface CheckpointRequest { sourceId: string; fields: CheckpointFields; parentId?: string; includeTerminal: boolean; includeGit: boolean }
