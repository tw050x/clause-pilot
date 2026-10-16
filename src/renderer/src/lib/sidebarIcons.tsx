// Sidebar toggle icons (Material Symbols). "open" is shown while the sidebar is
// closed (its arrow points the way the sidebar will open), "close" while it is open.
const PATHS = {
  leftOpen:
    'M500-640v320l160-160-160-160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm120-80v-560H200v560h120Zm80 0h360v-560H400v560Zm-80 0H200h120Z',
  leftClose:
    'M660-320v-320L500-480l160 160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm120-80v-560H200v560h120Zm80 0h360v-560H400v560Zm-80 0H200h120Z',
  rightOpen:
    'M460-320v-320L300-480l160 160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm440-80h120v-560H640v560Zm-80 0v-560H200v560h360Zm80 0h120-120Z',
  rightClose:
    'M300-640v320l160-160-160-160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm440-80h120v-560H640v560Zm-80 0v-560H200v560h360Zm80 0h120-120Z'
}

export function SidebarIcon({ side, open, size = 20 }: { side: 'left' | 'right'; open: boolean; size?: number }) {
  const d = side === 'left' ? (open ? PATHS.leftClose : PATHS.leftOpen) : open ? PATHS.rightClose : PATHS.rightOpen
  return (
    <svg xmlns="http://www.w3.org/2000/svg" height={size} width={size} viewBox="0 -960 960 960" fill="currentColor" aria-hidden>
      <path d={d} />
    </svg>
  )
}
