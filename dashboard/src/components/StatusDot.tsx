import { STATUS_COLORS } from "../theme";

export const StatusDot = ({ status }: { status: boolean }) => <span style={{ background: STATUS_COLORS[status === false ? 'disconnected' : 'connected'] ?? "#888", borderRadius: "50%", boxShadow: status ? `0 0 6px ${STATUS_COLORS.connected}` : "none", display: "inline-block", flexShrink: 0, height: 7, marginRight: 5, width: 7 }} />
