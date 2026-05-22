import { MessageOutlined } from '@ant-design/icons';
import { toggleChat, useChatStore } from './chat-store.js';

/**
 * Floating action button that opens the chat drawer.
 * Hides itself automatically when the drawer is open.
 * The ChatDrawer component renders this inline; this export
 * is also available for standalone use if needed.
 */
export function ChatToggleButton() {
  const { isOpen } = useChatStore();
  return (
    <button
      type="button"
      className={`chat-toggle-fab${isOpen ? ' chat-toggle-fab--hidden' : ''}`}
      onClick={toggleChat}
      aria-label="Open Capiro AI"
      aria-expanded={isOpen}
      title="Capiro AI"
    >
      <MessageOutlined style={{ fontSize: 20 }} />
    </button>
  );
}
