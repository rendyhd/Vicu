import { app } from 'electron'
import { join } from 'path'
import { removeFileAndBackup } from '../atomic-file'
import { JsonFileStore } from '../json-file-store'
import { AI_LIMITS } from '../../shared/ai/contract'
import type { KeptTranscript, StoredConversation } from '../../shared/ai/types'

// What the assistant keeps on this device only (docs/ai-assistant-v1.md sections 4.6, 5.1, 7.2):
// the last conversations (userData/ai-conversations.json) and the transcripts of failed dictation
// requests (userData/ai-kept-transcripts.json), which survive the app closing until they are added
// or discarded. They hold the account's task data, so signing out or switching accounts deletes
// them (clearAiAccountData); the device settings and the key stay.

interface LocalData {
  conversations: StoredConversation[]
}

let conversations: JsonFileStore<LocalData> | null = null
let kept: JsonFileStore<KeptTranscript[]> | null = null

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The kept conversations, newest first, each cut to its last 100 messages; at most 5. */
export function normaliseConversations(value: unknown): StoredConversation[] {
  if (!Array.isArray(value)) return []
  const out: StoredConversation[] = []
  for (const raw of value) {
    if (!isObject(raw) || typeof raw.id !== 'string' || !Array.isArray(raw.messages)) continue
    const messages = raw.messages.filter((m): m is StoredConversation['messages'][number] => isObject(m) && isObject(m.message) && typeof m.at === 'number')
    out.push({
      id: raw.id,
      title: typeof raw.title === 'string' ? raw.title : '',
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
      talk: raw.talk === true,
      messages: messages.slice(-AI_LIMITS.conversation_max_messages),
      taskIds: Array.isArray(raw.taskIds) ? raw.taskIds.filter((id): id is number => typeof id === 'number') : [],
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, AI_LIMITS.conversations_kept)
}

function conversationStore(): JsonFileStore<LocalData> {
  if (!conversations) {
    conversations = new JsonFileStore<LocalData>({
      path: join(app.getPath('userData'), 'ai-conversations.json'),
      backup: false,
      label: 'AI conversations', // i18n-ignore: log label
      empty: () => ({ conversations: [] }),
      parse: (json) => ({ conversations: normaliseConversations(isObject(json) ? json.conversations : []) }),
    })
    conversations.load()
  }
  return conversations
}

function keptStore(): JsonFileStore<KeptTranscript[]> {
  if (!kept) {
    kept = new JsonFileStore<KeptTranscript[]>({
      path: join(app.getPath('userData'), 'ai-kept-transcripts.json'),
      backup: true,
      label: 'Kept transcripts', // i18n-ignore: log label
      empty: () => [],
      parse: (json) => (Array.isArray(json) ? json.filter((k): k is KeptTranscript => isObject(k) && typeof k.id === 'string' && typeof k.transcript === 'string') : []),
    })
    kept.load()
  }
  return kept
}

export function getConversations(): StoredConversation[] {
  return conversationStore().state.conversations
}

export async function saveConversations(list: unknown): Promise<StoredConversation[]> {
  const store = conversationStore()
  store.state = { conversations: normaliseConversations(list) }
  await store.save()
  return store.state.conversations
}

export function getKeptTranscripts(): KeptTranscript[] {
  return keptStore().state
}

export async function keepTranscript(entry: KeptTranscript): Promise<void> {
  const store = keptStore()
  store.state = [...store.state.filter((k) => k.id !== entry.id), entry]
  await store.save()
}

export async function dropKeptTranscript(id: string): Promise<void> {
  const store = keptStore()
  store.state = store.state.filter((k) => k.id !== id)
  await store.save()
}

/** Sign-out and account switch: the conversations and kept transcripts go; settings and key stay. */
export async function clearAiAccountData(): Promise<void> {
  await conversations?.flush()
  await kept?.flush()
  conversations = null
  kept = null
  for (const name of ['ai-conversations.json', 'ai-kept-transcripts.json']) {
    try {
      removeFileAndBackup(join(app.getPath('userData'), name))
    } catch (err) {
      console.warn('[AI] Could not delete', name, err instanceof Error ? err.message : err)
    }
  }
}

export async function flushAiLocalData(): Promise<void> {
  await conversations?.flush()
  await kept?.flush()
}
