import { MemoryItem } from '../types';

const MEMORY_KEY = 'jarvis_long_term_memory';

export const MemoryService = {
  /**
   * Loads all memories from storage.
   */
  load: (): MemoryItem[] => {
    try {
      const stored = localStorage.getItem(MEMORY_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error("无法加载记忆库", e);
      return [];
    }
  },

  /**
   * Saves a new fact.
   */
  save: (key: string, value: string): MemoryItem => {
    const memories = MemoryService.load();
    const newItem: MemoryItem = { key, value, addedAt: Date.now() };
    
    // Remove duplicates for the same key roughly
    const filtered = memories.filter(m => m.key !== key);
    filtered.push(newItem);
    
    localStorage.setItem(MEMORY_KEY, JSON.stringify(filtered));
    return newItem;
  },

  /**
   * Generates a context string to feed into the AI system instruction.
   */
  getContextString: (): string => {
    const memories = MemoryService.load();
    if (memories.length === 0) return "暂无历史记忆。";
    
    return memories.map(m => `- [记忆-${m.key}]: ${m.value}`).join('\n');
  },

  /**
   * Clears memory.
   */
  clear: () => {
    localStorage.removeItem(MEMORY_KEY);
  }
};