export const MEMORY_MAX_CHARS = 3000;
export const MEMORY_LIMIT_ERROR = 'MEMORY.md exceeds 3000 characters. Read it with bot_read_state({"target":"memory"}), condense it, then use bot_update_state({"target":"memory","action":"overwrite","content":"...","expectedSha256":"<sha256 from read>"}). The replacement must be at most 3000 characters.';
export function validateMemory(content: string) {
  if (content.length > MEMORY_MAX_CHARS) throw new Error(MEMORY_LIMIT_ERROR);
  return content;
}
